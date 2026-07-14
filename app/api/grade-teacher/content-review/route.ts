import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

function requireGradeTeacher(role: string | undefined) {
  return role === "grade_teacher" || role === "admin";
}

// GET — pending + recently reviewed teacher content across all subjects.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!requireGradeTeacher(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items = await query(
    `SELECT tc.id, tc.subject_name, tc.topic_name, tc.content_type, tc.content, tc.title,
            tc.approval_status, tc.review_note, tc.submitted_at, tc.created_at,
            u.name AS teacher_name
       FROM teacher_content tc
       LEFT JOIN users u ON u.id = tc.added_by
      ORDER BY (tc.approval_status = 'pending') DESC, tc.submitted_at DESC NULLS LAST, tc.created_at DESC
      LIMIT 200`
  );
  return NextResponse.json({ items });
}

// PATCH { contentId, action: 'approve'|'reject', note? }
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!requireGradeTeacher(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { contentId?: string; action?: string; note?: string };
  if (!body.contentId || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ error: "contentId and action (approve|reject) required" }, { status: 400 });
  }
  const row = await queryOne<{ subject_name: string; topic_name: string; title: string }>(
    "SELECT subject_name, topic_name, title FROM teacher_content WHERE id = $1",
    [body.contentId]
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const status = body.action === "approve" ? "approved" : "rejected";
  await execute(
    "UPDATE teacher_content SET approval_status = $1, reviewed_by = $2, review_note = $3 WHERE id = $4",
    [status, user.id, body.note?.trim() || null, body.contentId]
  );

  // On approval, notify every student in the subject's grade.
  if (status === "approved") {
    const file = await queryOne<{ grade_level_id: string }>(
      "SELECT grade_level_id FROM syllabus_files WHERE subject = $1 LIMIT 1",
      [row.subject_name]
    );
    if (file?.grade_level_id) {
      const students = await query<{ id: string }>(
        "SELECT id FROM users WHERE role = 'student' AND grade_level_id = $1",
        [file.grade_level_id]
      );
      const now = nowIso();
      const content = `New ${row.subject_name} material approved: "${row.title}" (${row.topic_name})`;
      for (const s of students) {
        await execute(
          "INSERT INTO student_notifications (id, user_id, from_user_id, type, content, read, created_at) VALUES ($1,$2,$3,'content_approved',$4,false,$5)",
          [uid("ntf"), s.id, user.id, content, now]
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
