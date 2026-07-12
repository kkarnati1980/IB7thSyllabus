import { Pool } from "pg";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Idempotent, additive-only migration for the opt-in school hierarchy.
// Safe to run repeatedly against production: every statement uses IF NOT EXISTS / ON CONFLICT.
const DDL = `
CREATE TABLE IF NOT EXISTS schools (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  academic_year TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

INSERT INTO schools (id, name, code, academic_year, created_at)
VALUES ('school_iish', 'IISH', 'IISH', '2026-2027', NOW()::text)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS grade_levels (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL REFERENCES schools(id),
  grade      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(school_id, grade)
);

INSERT INTO grade_levels (id, school_id, grade, created_at)
VALUES ('grade_7_iish', 'school_iish', '7', NOW()::text)
ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade_level_id TEXT REFERENCES grade_levels(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_to_school BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_id TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE TABLE IF NOT EXISTS subject_assignments (
  id             TEXT PRIMARY KEY,
  teacher_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_name   TEXT NOT NULL,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id),
  created_at     TEXT NOT NULL,
  UNIQUE(teacher_id, subject_name, grade_level_id)
);

CREATE TABLE IF NOT EXISTS myp_criteria (
  id             TEXT PRIMARY KEY,
  subject_name   TEXT NOT NULL,
  criterion      TEXT NOT NULL,
  criterion_name TEXT NOT NULL,
  max_score      INTEGER NOT NULL DEFAULT 8,
  configured_by  TEXT REFERENCES users(id),
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id),
  created_at     TEXT NOT NULL,
  UNIQUE(subject_name, criterion, grade_level_id)
);

CREATE TABLE IF NOT EXISTS myp_assessments (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  topic_id     TEXT NOT NULL,
  topic_name   TEXT NOT NULL,
  criterion    TEXT NOT NULL,
  raw_score    INTEGER NOT NULL DEFAULT 0 CHECK (raw_score >= 0 AND raw_score <= 8),
  suggested_by TEXT NOT NULL DEFAULT 'jarvis',
  confirmed    BOOLEAN NOT NULL DEFAULT false,
  confirmed_by TEXT REFERENCES users(id),
  overall_1_7  INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN raw_score = 0 THEN 1
      WHEN raw_score <= 2 THEN 2
      WHEN raw_score <= 4 THEN 3
      WHEN raw_score <= 5 THEN 4
      WHEN raw_score <= 6 THEN 5
      WHEN raw_score <= 7 THEN 6
      ELSE 7
    END
  ) STORED,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_id, topic_id, criterion)
);

CREATE TABLE IF NOT EXISTS teacher_content (
  id           TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  topic_name   TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content      TEXT NOT NULL,
  title        TEXT NOT NULL,
  added_by     TEXT NOT NULL REFERENCES users(id),
  visible      BOOLEAN NOT NULL DEFAULT true,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_flags (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL,
  topic_name   TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  flagged_by   TEXT NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  content      TEXT NOT NULL,
  from_user_id TEXT REFERENCES users(id),
  read         BOOLEAN NOT NULL DEFAULT false,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wall_messages (
  id              TEXT PRIMARY KEY,
  from_user_id    TEXT NOT NULL REFERENCES users(id),
  to_user_id      TEXT REFERENCES users(id),
  subject_context TEXT,
  grade_context   TEXT,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_myp_assessments_user ON myp_assessments(user_id, subject_name);
CREATE INDEX IF NOT EXISTS idx_teacher_content_subject ON teacher_content(subject_name, topic_name);
CREATE INDEX IF NOT EXISTS idx_topic_flags_user ON topic_flags(user_id, resolved);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON student_notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_wall_messages_to ON wall_messages(to_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wall_messages_subject ON wall_messages(subject_context, created_at);
`;

// Default MYP criteria (Grade 7, IISH). [id, subject, criterion, criterion_name]
const CRITERIA: [string, string, string, string][] = [
  ["crit_sci_a", "Sciences", "A", "Knowing and Understanding"],
  ["crit_sci_b", "Sciences", "B", "Inquiring and Designing"],
  ["crit_sci_c", "Sciences", "C", "Processing and Evaluating"],
  ["crit_sci_d", "Sciences", "D", "Reflecting on the Impacts"],
  ["crit_math_a", "Mathematics", "A", "Knowing and Understanding"],
  ["crit_math_b", "Mathematics", "B", "Investigating Patterns"],
  ["crit_math_c", "Mathematics", "C", "Communicating"],
  ["crit_math_d", "Mathematics", "D", "Applying Mathematics"],
  ["crit_lang_a", "Language and Literature", "A", "Analysing"],
  ["crit_lang_b", "Language and Literature", "B", "Organizing"],
  ["crit_lang_c", "Language and Literature", "C", "Producing Text"],
  ["crit_lang_d", "Language and Literature", "D", "Using Language"],
  ["crit_is_a", "Individuals and Societies", "A", "Knowing and Understanding"],
  ["crit_is_b", "Individuals and Societies", "B", "Investigating"],
  ["crit_is_c", "Individuals and Societies", "C", "Communicating"],
  ["crit_is_d", "Individuals and Societies", "D", "Thinking Critically"],
  ["crit_arts_a", "Arts", "A", "Knowing and Understanding"],
  ["crit_arts_b", "Arts", "B", "Developing Skills"],
  ["crit_arts_c", "Arts", "C", "Thinking Creatively"],
  ["crit_arts_d", "Arts", "D", "Responding"],
  ["crit_des_a", "Design", "A", "Inquiring and Analysing"],
  ["crit_des_b", "Design", "B", "Developing Ideas"],
  ["crit_des_c", "Design", "C", "Creating the Solution"],
  ["crit_des_d", "Design", "D", "Evaluating"],
  ["crit_pahe_a", "Physical and Health Education", "A", "Knowing and Understanding"],
  ["crit_pahe_b", "Physical and Health Education", "B", "Planning for Performance"],
  ["crit_pahe_c", "Physical and Health Education", "C", "Applying and Performing"],
  ["crit_pahe_d", "Physical and Health Education", "D", "Reflecting and Improving"],
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log("Schema applied.");

    for (const [id, subject, criterion, name] of CRITERIA) {
      await client.query(
        `INSERT INTO myp_criteria (id, subject_name, criterion, criterion_name, max_score, grade_level_id, created_at)
         VALUES ($1, $2, $3, $4, 8, 'grade_7_iish', NOW()::text)
         ON CONFLICT DO NOTHING`,
        [id, subject, criterion, name]
      );
    }
    console.log(`Seeded ${CRITERIA.length} MYP criteria.`);

    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('schools','grade_levels','subject_assignments','myp_criteria',
           'myp_assessments','teacher_content','topic_flags','student_notifications','wall_messages')
       ORDER BY table_name`
    );
    console.log("Tables present:", tables.rows.map((r) => r.table_name).join(", "));
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users'
         AND column_name IN ('school_id','grade_level_id','linked_to_school','guardian_id','display_name')
       ORDER BY column_name`
    );
    console.log("users new columns:", cols.rows.map((r) => r.column_name).join(", "));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
