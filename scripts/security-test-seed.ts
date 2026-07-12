import { Pool } from "pg";
import { randomBytes, scryptSync } from "crypto";
import * as dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Verify TLS against Supabase's pinned root CA (pooler serves a self-signed chain).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: fs.readFileSync(path.join(process.cwd(), "scripts", "supabase-ca.pem"), "utf8"),
    rejectUnauthorized: true,
  },
});

function uid(p: string) { return `${p}_${randomBytes(9).toString("hex")}`; }
function hash(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const h = scryptSync(pw, salt, 64).toString("hex");
  return { hash: h, salt };
}
function now() { return new Date().toISOString(); }

async function seed() {
  const client = await pool.connect();
  try {
    // Create test subject teacher
    const teacherId = "test_sec_teacher_001";
    const studentId = "test_sec_student_001";
    const { hash: th, salt: ts } = hash("TestPass123!");
    const { hash: sh, salt: ss } = hash("TestPass123!");

    await client.query(`
      INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at,
                         school_id, grade_level_id, linked_to_school)
      VALUES ($1,'Security Test Teacher','sec_teacher@test.internal','subject_teacher',$2,$3,true,$4,
              'school_iish','grade_7_iish',true)
      ON CONFLICT (email) DO UPDATE SET id = $1
    `, [teacherId, th, ts, now()]);

    await client.query(`
      INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at,
                         school_id, grade_level_id, linked_to_school)
      VALUES ($1,'Security Test Student','sec_student@test.internal','student',$2,$3,true,$4,
              'school_iish','grade_7_iish',true)
      ON CONFLICT (email) DO UPDATE SET id = $1
    `, [studentId, sh, ss, now()]);

    // Assign teacher to Chemistry
    await client.query(`
      INSERT INTO subject_assignments (id, teacher_id, subject_name, grade_level_id, created_at)
      VALUES ($1,$2,'Chemistry','grade_7_iish',$3)
      ON CONFLICT DO NOTHING
    `, [uid("sa"), teacherId, now()]);

    // Create a real assessment for the student (to test IDOR)
    await client.query(`
      INSERT INTO myp_assessments (id, user_id, subject_name, topic_id, topic_name,
                                   criterion, raw_score, suggested_by, confirmed, updated_at)
      VALUES ($1,$2,'Chemistry','topic_real_001','The Atom','A',5,'jarvis',false,$3)
      ON CONFLICT (user_id, topic_id, criterion) DO UPDATE SET raw_score = 5
    `, [uid("assess"), studentId, now()]);

    console.log("✓ Seeded:");
    console.log("  Teacher: sec_teacher@test.internal / TestPass123!");
    console.log("  Student: sec_student@test.internal / TestPass123!");
    console.log("  Teacher ID:", teacherId);
    console.log("  Student ID:", studentId);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });
