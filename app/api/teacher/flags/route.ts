import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type User } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

async function ownsSubject(user: User, subjectName: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const ok = await queryOne(
    "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
    [user.id, subjectName, GRADE_LEVEL_ID]
  );
  return !!ok;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Flags this teacher raised across their assigned subjects.
    const flags = await query(
      `SELECT f.id, f.user_id, f.topic_id, f.topic_name, f.subject_name, f.reason, f.resolved, f.created_at,
              u.display_name, u.name AS student_name
         FROM topic_flags f
         JOIN users u ON u.id = f.user_id
        WHERE f.flagged_by = $1
        ORDER BY f.created_at DESC`,
      [user.id]
    );
    return NextResponse.json({ flags });
  } catch (e) {
    console.error("teacher flags GET failed", e);
    return NextResponse.json({ error: "Failed to load flags" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      topicId?: string;
      topicName?: string;
      subjectName?: string;
      reason?: string;
    };
    const { userId, topicId, topicName, subjectName, reason } = body;
    if (!userId || !topicId || !topicName || !subjectName || !reason) {
      return NextResponse.json(
        { error: "userId, topicId, topicName, subjectName and reason required" },
        { status: 400 }
      );
    }
    if (!(await ownsSubject(user, subjectName))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Target must be a real linked student — never flag/notify an arbitrary account.
    const target = await queryOne<{ role: string; linked_to_school: boolean }>(
      "SELECT role, linked_to_school FROM users WHERE id = $1",
      [userId]
    );
    if (!target || target.role !== "student" || !target.linked_to_school) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    await execute(
      `INSERT INTO topic_flags (id, user_id, topic_id, topic_name, subject_name, flagged_by, reason, resolved, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
      [uid("flag"), userId, topicId, topicName, subjectName, user.id, reason, nowIso()]
    );
    await execute(
      `INSERT INTO student_notifications (id, user_id, type, content, from_user_id, read, created_at)
       VALUES ($1, $2, 'flag', $3, $4, false, $5)`,
      [uid("ntf"), userId, reason, user.id, nowIso()]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("teacher flags POST failed", e);
    return NextResponse.json({ error: "Failed to flag topic" }, { status: 500 });
  }
}
