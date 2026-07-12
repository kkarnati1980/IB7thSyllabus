import { Pool } from "pg";
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

async function cleanup() {
  const client = await pool.connect();
  try {
    const teacherId = "test_sec_teacher_001";
    const studentId = "test_sec_student_001";

    // Delete in dependency order
    await client.query("DELETE FROM wall_messages WHERE from_user_id IN ($1,$2) OR to_user_id IN ($1,$2)", [teacherId, studentId]);
    await client.query("DELETE FROM student_notifications WHERE user_id = $1 OR from_user_id = $2", [studentId, teacherId]);
    await client.query("DELETE FROM topic_flags WHERE user_id = $1 OR flagged_by = $2", [studentId, teacherId]);
    await client.query("DELETE FROM myp_assessments WHERE user_id = $1", [studentId]);
    await client.query("DELETE FROM teacher_content WHERE added_by = $1", [teacherId]);
    await client.query("DELETE FROM subject_assignments WHERE teacher_id = $1", [teacherId]);
    await client.query("DELETE FROM lesson_sessions WHERE user_id IN ($1,$2)", [teacherId, studentId]);
    await client.query("DELETE FROM progress WHERE user_id IN ($1,$2)", [teacherId, studentId]);
    await client.query("DELETE FROM sessions WHERE user_id IN ($1,$2)", [teacherId, studentId]);
    await client.query("DELETE FROM audit_log WHERE user_id IN ($1,$2)", [teacherId, studentId]);
    await client.query("DELETE FROM users WHERE id IN ($1,$2)", [teacherId, studentId]);

    console.log("✓ Cleaned up all test data");
    console.log("  Removed: test_sec_teacher_001, test_sec_student_001");
    console.log("  Removed: all associated sessions, assessments, flags, content, assignments");
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch(e => { console.error(e); process.exit(1); });
