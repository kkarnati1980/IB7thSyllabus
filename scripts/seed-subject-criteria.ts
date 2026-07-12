import { Pool } from "pg";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const GRADE_LEVEL_ID = "grade_7_iish";

// MYP criteria are defined per subject GROUP. Each real (short_name) subject
// inherits its group's A–D criterion names.
const GROUP_CRITERIA: Record<string, [string, string, string, string]> = {
  Sciences: ["Knowing and Understanding", "Inquiring and Designing", "Processing and Evaluating", "Reflecting on the Impacts"],
  Mathematics: ["Knowing and Understanding", "Investigating Patterns", "Communicating", "Applying Mathematics"],
  "Language and Literature": ["Analysing", "Organizing", "Producing Text", "Using Language"],
  "Individuals and Societies": ["Knowing and Understanding", "Investigating", "Communicating", "Thinking Critically"],
  Arts: ["Knowing and Understanding", "Developing Skills", "Thinking Creatively", "Responding"],
  Design: ["Inquiring and Analysing", "Developing Ideas", "Creating the Solution", "Evaluating"],
  "Physical and Health Education": ["Knowing and Understanding", "Planning for Performance", "Applying and Performing", "Reflecting and Improving"],
  "Language Acquisition": ["Comprehending Spoken and Visual Text", "Comprehending Written and Visual Text", "Communicating", "Using Language"],
};

// The 13 real subjects (syllabus_files.short_name) → their MYP group.
const SUBJECT_GROUP: Record<string, string> = {
  Biology: "Sciences",
  Chemistry: "Sciences",
  Physics: "Sciences",
  Mathematics: "Mathematics",
  "Language & Literature": "Language and Literature",
  Geography: "Individuals and Societies",
  History: "Individuals and Societies",
  Music: "Arts",
  Theatre: "Arts",
  "Visual Art": "Arts",
  "Digital Design": "Design",
  PAHE: "Physical and Health Education",
  "World Languages": "Language Acquisition",
};

// Old group-named criteria rows that are NOT themselves real subjects — remove so
// grade summaries list exactly the 13 subjects. (Mathematics is kept: it is both.)
const ORPHAN_GROUPS = [
  "Sciences",
  "Language and Literature",
  "Individuals and Societies",
  "Arts",
  "Design",
  "Physical and Health Education",
];

const LETTERS = ["A", "B", "C", "D"];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function run() {
  const client = await pool.connect();
  try {
    // Remove orphan group-named rows FIRST — their ids (e.g. crit_pahe_a) would
    // otherwise collide with the per-subject ids on the primary key.
    const del = await client.query(
      `DELETE FROM myp_criteria WHERE grade_level_id = $1 AND subject_name = ANY($2::text[])`,
      [GRADE_LEVEL_ID, ORPHAN_GROUPS]
    );
    console.log(`Removed ${del.rowCount ?? 0} orphan group-named criteria rows.`);

    let inserted = 0;
    for (const [subject, group] of Object.entries(SUBJECT_GROUP)) {
      const names = GROUP_CRITERIA[group];
      for (let i = 0; i < 4; i++) {
        const res = await client.query(
          `INSERT INTO myp_criteria (id, subject_name, criterion, criterion_name, max_score, grade_level_id, created_at)
           VALUES ($1, $2, $3, $4, 8, $5, NOW()::text)
           ON CONFLICT (subject_name, criterion, grade_level_id) DO NOTHING`,
          [`crit_${slug(subject)}_${LETTERS[i].toLowerCase()}`, subject, LETTERS[i], names[i], GRADE_LEVEL_ID]
        );
        inserted += res.rowCount ?? 0;
      }
    }
    console.log(`Inserted ${inserted} per-subject criteria rows (existing rows skipped).`);

    const summary = await client.query<{ subject_name: string; n: string }>(
      `SELECT subject_name, COUNT(*) AS n FROM myp_criteria WHERE grade_level_id = $1
        GROUP BY subject_name ORDER BY subject_name`,
      [GRADE_LEVEL_ID]
    );
    console.log(`Configured subjects (${summary.rows.length}):`);
    for (const r of summary.rows) console.log(`  ${r.subject_name} — ${r.n} criteria`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
