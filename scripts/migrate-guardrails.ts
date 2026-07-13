import { Pool } from "pg";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Idempotent, additive-only migration for content guardrails + grade-scoped KB.
// Safe to run repeatedly against production: every statement uses IF NOT EXISTS / ON CONFLICT.
const DDL = `
ALTER TABLE syllabus_files ADD COLUMN IF NOT EXISTS grade_level_id TEXT REFERENCES grade_levels(id);
ALTER TABLE syllabus_chunks ADD COLUMN IF NOT EXISTS grade_level_id TEXT;
UPDATE syllabus_files SET grade_level_id = 'grade_7_iish' WHERE grade_level_id IS NULL;
UPDATE syllabus_chunks SET grade_level_id = 'grade_7_iish' WHERE grade_level_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_syllabus_files_grade ON syllabus_files(grade_level_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_chunks_grade ON syllabus_chunks(grade_level_id);

CREATE TABLE IF NOT EXISTS allowed_video_channels (
  id            TEXT PRIMARY KEY,
  channel_name  TEXT NOT NULL,
  channel_keywords TEXT NOT NULL,
  grade_level_id TEXT REFERENCES grade_levels(id),
  added_by      TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);

INSERT INTO allowed_video_channels (id, channel_name, channel_keywords, grade_level_id, added_by, created_at) VALUES
('chan_khanacademy','Khan Academy','khan academy,khanacademy',NULL,NULL,NOW()::text),
('chan_crashcourse','CrashCourse','crash course,crashcourse',NULL,NULL,NOW()::text),
('chan_kurzgesagt','Kurzgesagt','kurzgesagt,in a nutshell',NULL,NULL,NOW()::text),
('chan_teded','TED-Ed','ted-ed,teded,ted ed',NULL,NULL,NOW()::text),
('chan_bbc','BBC','bbc education,bbc teach,bbc science',NULL,NULL,NOW()::text),
('chan_natgeo','National Geographic','national geographic,nat geo',NULL,NULL,NOW()::text),
('chan_veritasium','Veritasium','veritasium',NULL,NULL,NOW()::text),
('chan_numberphile','Numberphile','numberphile',NULL,NULL,NOW()::text),
('chan_scishow','SciShow','scishow',NULL,NULL,NOW()::text)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS content_moderation_log (
  id            TEXT PRIMARY KEY,
  content_type  TEXT NOT NULL,
  content_preview TEXT NOT NULL,
  decision      TEXT NOT NULL,
  reason        TEXT,
  moderated_by  TEXT NOT NULL DEFAULT 'jarvis-ai',
  submitted_by  TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS standalone_grade_id TEXT REFERENCES grade_levels(id);
`;

async function run() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log("Schema applied.");

    const filesGraded = await client.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM syllabus_files WHERE grade_level_id IS NOT NULL"
    );
    const chunksGraded = await client.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM syllabus_chunks WHERE grade_level_id IS NOT NULL"
    );
    const channels = await client.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM allowed_video_channels"
    );
    const filesN = Number(filesGraded.rows[0]?.n ?? 0);
    const chunksN = Number(chunksGraded.rows[0]?.n ?? 0);
    const chanN = Number(channels.rows[0]?.n ?? 0);
    console.log(`syllabus_files with grade: ${filesN}`);
    console.log(`syllabus_chunks with grade: ${chunksN}`);
    console.log(`allowed_video_channels: ${chanN}`);
    if (filesN === 0 || chunksN === 0 || chanN === 0) {
      throw new Error("Verification failed — a required count is 0.");
    }
    console.log("Verification passed.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
