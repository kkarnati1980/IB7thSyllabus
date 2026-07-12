import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

// Grade teacher flags a topic as needing attention for one student.
// Inserts a topic_flags row + a 'flag' notification so the student's bell lights up.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "grade_teacher" && user.role !== "admin") {
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
    const { userId, topicId, topicName, subjectName } = body;
    const reason = (body.reason ?? "").trim();
    if (!userId || !topicId || !topicName || !subjectName || !reason) {
      return NextResponse.json(
        { error: "userId, topicId, topicName, subjectName and reason are required" },
        { status: 400 }
      );
    }

    const target = await queryOne<{ role: string; linked_to_school: boolean }>(
      "SELECT role, linked_to_school FROM users WHERE id = $1",
      [userId]
    );
    if (!target || target.role !== "student" || !target.linked_to_school) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const now = nowIso();
    await execute(
      `INSERT INTO topic_flags (id, user_id, topic_id, topic_name, subject_name, flagged_by, reason, resolved, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
      [uid("flag"), userId, topicId, topicName, subjectName, user.id, reason, now]
    );
    await execute(
      `INSERT INTO student_notifications (id, user_id, type, content, from_user_id, created_at)
       VALUES ($1, $2, 'flag', $3, $4, $5)`,
      [uid("ntf"), userId, `${subjectName} · ${topicName}: ${reason}`, user.id, now]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("grade-teacher flag POST failed", e);
    return NextResponse.json({ error: "Failed to flag topic" }, { status: 500 });
  }
}
