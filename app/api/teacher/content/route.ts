import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type User } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

// admin passes for any subject; subject_teacher must be assigned to it.
async function ownsSubject(user: User, subjectName: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const ok = await queryOne(
    "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
    [user.id, subjectName, GRADE_LEVEL_ID]
  );
  return !!ok;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isTeacher = user.role === "subject_teacher" || user.role === "admin";
  const isStudent = user.role === "student";
  if (!isTeacher && !isStudent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const subjectName = searchParams.get("subjectName");
    if (!subjectName) return NextResponse.json({ error: "subjectName required" }, { status: 400 });
    // Students may only read visible content and don't need subject ownership.
    if (isTeacher && !(await ownsSubject(user, subjectName))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const topicName = searchParams.get("topicName");
    const visible = isStudent ? "true" : searchParams.get("visible");

    const clauses = ["subject_name = $1"];
    const params: unknown[] = [subjectName];
    if (topicName) {
      params.push(topicName);
      clauses.push(`topic_name = $${params.length}`);
    }
    if (visible === "true" || visible === "false") {
      params.push(visible === "true");
      clauses.push(`visible = $${params.length}`);
    }
    const content = await query(
      `SELECT id, subject_name, topic_name, content_type, content, title, added_by, visible, created_at
         FROM teacher_content WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    return NextResponse.json({ content });
  } catch (e) {
    console.error("teacher content GET failed", e);
    return NextResponse.json({ error: "Failed to load content" }, { status: 500 });
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
      subjectName?: string;
      topicName?: string;
      contentType?: string;
      content?: string;
      title?: string;
    };
    const { subjectName, topicName, contentType, content, title } = body;
    if (!subjectName || !topicName || !contentType || !content || !title) {
      return NextResponse.json(
        { error: "subjectName, topicName, contentType, content and title required" },
        { status: 400 }
      );
    }
    if (!["text", "image", "video"].includes(contentType)) {
      return NextResponse.json({ error: "Invalid contentType" }, { status: 400 });
    }
    if (!(await ownsSubject(user, subjectName))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await execute(
      `INSERT INTO teacher_content (id, subject_name, topic_name, content_type, content, title, added_by, visible, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [uid("tc"), subjectName, topicName, contentType, content, title, user.id, nowIso()]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("teacher content POST failed", e);
    return NextResponse.json({ error: "Failed to add content" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; visible?: boolean };
    if (!body.id || typeof body.visible !== "boolean") {
      return NextResponse.json({ error: "id and visible required" }, { status: 400 });
    }
    const row = await queryOne<{ subject_name: string }>(
      "SELECT subject_name FROM teacher_content WHERE id = $1",
      [body.id]
    );
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await ownsSubject(user, row.subject_name))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await execute("UPDATE teacher_content SET visible = $1 WHERE id = $2", [body.visible, body.id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("teacher content PATCH failed", e);
    return NextResponse.json({ error: "Failed to update content" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const row = await queryOne<{ subject_name: string }>(
      "SELECT subject_name FROM teacher_content WHERE id = $1",
      [id]
    );
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await ownsSubject(user, row.subject_name))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await execute("DELETE FROM teacher_content WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("teacher content DELETE failed", e);
    return NextResponse.json({ error: "Failed to delete content" }, { status: 500 });
  }
}
