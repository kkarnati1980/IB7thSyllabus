import { Pool } from "pg";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Idempotent, additive-only migration (Foundation Fixes — Prompt 1).
// Safe to run repeatedly against production: every statement uses
// IF NOT EXISTS / ON CONFLICT and never drops or rewrites existing data.
const DDL = `
-- grade_levels: display name + description
ALTER TABLE grade_levels ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE grade_levels ADD COLUMN IF NOT EXISTS description TEXT;
UPDATE grade_levels SET display_name = 'Grade 7' WHERE grade = '7' AND display_name IS NULL;

-- LLM provider configs (one row per purpose)
CREATE TABLE IF NOT EXISTS llm_configs (
  id            TEXT PRIMARY KEY,
  purpose       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model_name    TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  base_url      TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  updated_at    TEXT NOT NULL,
  UNIQUE(purpose)
);

-- PDF upload tracking for KB generation
CREATE TABLE IF NOT EXISTS kb_upload_jobs (
  id            TEXT PRIMARY KEY,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id),
  original_filename TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  chunks_created INTEGER DEFAULT 0,
  error_message TEXT,
  uploaded_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_jobs_grade ON kb_upload_jobs(grade_level_id, status);

-- Video suggestions produced by KB auto-sourcing (non-destructive, review-only)
CREATE TABLE IF NOT EXISTS video_suggestions (
  id            TEXT PRIMARY KEY,
  file_id       TEXT,
  heading       TEXT NOT NULL,
  title         TEXT NOT NULL,
  channel       TEXT,
  search_query  TEXT,
  created_at    TEXT NOT NULL
);

-- Phase 4a: subject-teacher content approval workflow
ALTER TABLE teacher_content ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE teacher_content ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id);
ALTER TABLE teacher_content ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE teacher_content ADD COLUMN IF NOT EXISTS submitted_at TEXT;
-- Existing content pre-dates the workflow: treat it as already approved so it stays visible.
UPDATE teacher_content SET approval_status = 'approved' WHERE approval_status = 'pending' AND submitted_at IS NULL;
`;

// Seed default llm_configs, migrating whatever keys already live in app_config.
const SEED = `
INSERT INTO llm_configs (id, purpose, provider, model_name, api_key, active, updated_at)
SELECT 'llm_chat_default', 'chat', 'anthropic', 'claude-sonnet-4-6',
  COALESCE((SELECT value FROM app_config WHERE key = 'anthropic_api_key'), ''), true, NOW()::text
ON CONFLICT (purpose) DO NOTHING;

INSERT INTO llm_configs (id, purpose, provider, model_name, api_key, active, updated_at)
SELECT 'llm_img_default', 'image_generation', 'openai', 'gpt-image-1',
  COALESCE((SELECT value FROM app_config WHERE key = 'openai_api_key'), ''), true, NOW()::text
ON CONFLICT (purpose) DO NOTHING;

INSERT INTO llm_configs (id, purpose, provider, model_name, api_key, active, updated_at)
SELECT 'llm_voice_default', 'voice_tts', 'elevenlabs', 'eleven_turbo_v2',
  COALESCE((SELECT value FROM app_config WHERE key = 'elevenlabs_api_key'), ''), true, NOW()::text
ON CONFLICT (purpose) DO NOTHING;

INSERT INTO llm_configs (id, purpose, provider, model_name, api_key, active, updated_at)
VALUES ('llm_mod_default', 'moderation', 'anthropic', 'claude-haiku-4-5-20251001', '', true, NOW()::text)
ON CONFLICT (purpose) DO NOTHING;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(DDL);
    await client.query(SEED);
    await client.query("COMMIT");
    const cfgs = await client.query(
      "SELECT purpose, provider, model_name, (api_key <> '') AS has_key FROM llm_configs ORDER BY purpose"
    );
    console.log("llm_configs:");
    for (const r of cfgs.rows)
      console.log(`  ${r.purpose.padEnd(18)} ${r.provider.padEnd(11)} ${r.model_name.padEnd(30)} key=${r.has_key}`);
    console.log("migrate-p1 complete.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("migrate-p1 FAILED:", e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
