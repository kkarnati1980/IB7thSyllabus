import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const grades = await query<{
    id: string; grade: string; display_name: string | null; description: string | null;
    school_id: string; school_name: string; file_count: string; student_count: string;
  }>(
    `SELECT gl.id, gl.grade, gl.display_name, gl.description, gl.school_id,
            s.name AS school_name,
            COUNT(DISTINCT sf.id) AS file_count,
            COUNT(DISTINCT u.id) AS student_count
       FROM grade_levels gl
       JOIN schools s ON s.id = gl.school_id
       LEFT JOIN syllabus_files sf ON sf.grade_level_id = gl.id
       LEFT JOIN users u ON u.grade_level_id = gl.id AND u.role = 'student'
      GROUP BY gl.id, s.name
      ORDER BY gl.grade`
  );
  return NextResponse.json({
    grades: grades.map((g) => ({
      id: g.id,
      grade: g.grade,
      displayName: g.display_name ?? `Grade ${g.grade}`,
      description: g.description ?? "",
      schoolId: g.school_id,
      schoolName: g.school_name,
      fileCount: Number(g.file_count),
      studentCount: Number(g.student_count),
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    grade?: string; displayName?: string; description?: string; schoolId?: string;
  };
  const grade = (body.grade ?? "").trim();
  const schoolId = (body.schoolId ?? "").trim();
  if (!grade || !schoolId) return NextResponse.json({ error: "grade and schoolId required" }, { status: 400 });
  const school = await queryOne("SELECT id FROM schools WHERE id = $1", [schoolId]);
  if (!school) return NextResponse.json({ error: "Unknown school" }, { status: 400 });
  const id = uid("grade");
  await execute(
    `INSERT INTO grade_levels (id, school_id, grade, display_name, description, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, schoolId, grade, (body.displayName ?? `Grade ${grade}`).trim(), (body.description ?? "").trim() || null, nowIso()]
  );
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; displayName?: string; description?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await execute(
    "UPDATE grade_levels SET display_name = COALESCE($2, display_name), description = $3 WHERE id = $1",
    [body.id, body.displayName?.trim() || null, body.description?.trim() ?? null]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const files = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM syllabus_files WHERE grade_level_id = $1", [id]);
  if (Number(files?.n ?? 0) > 0) {
    return NextResponse.json({ error: "Cannot delete a grade that still has syllabus files." }, { status: 409 });
  }
  const students = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM users WHERE grade_level_id = $1 AND role = 'student'", [id]);
  if (Number(students?.n ?? 0) > 0) {
    return NextResponse.json({ error: "Cannot delete a grade that still has students." }, { status: 409 });
  }
  await execute("DELETE FROM grade_levels WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
