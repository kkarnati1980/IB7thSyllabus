import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, execute, nowIso, query, queryOne, uid } from "@/lib/db";
import type { PublicUser } from "@/lib/types";

export const runtime = "nodejs";

const SCHOOL_ID = "school_iish";
const GRADE_LEVEL_ID = "grade_7_iish";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

async function listUsers(): Promise<PublicUser[]> {
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    role: PublicUser["role"];
    active: boolean;
    created_at: string;
    linked_to_school: boolean;
  }>("SELECT id, name, email, role, active, created_at, linked_to_school FROM users ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    active: !!r.active,
    createdAt: r.created_at,
    linkedToSchool: !!r.linked_to_school,
  }));
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Subject picker source: the real per-file subjects (short_name), not MYP group names.
  if (new URL(req.url).searchParams.get("type") === "subjects") {
    const subjects = await query<{ short_name: string; subject: string }>(
      `SELECT DISTINCT COALESCE(short_name, subject) AS short_name, subject
         FROM syllabus_files
        WHERE COALESCE(short_name, subject) NOT IN ('IB Framework', 'Knowledge Index')
        ORDER BY short_name ASC`
    );
    return NextResponse.json({ subjects });
  }

  const users = await query<{
    id: string;
    name: string;
    email: string;
    role: PublicUser["role"];
    linked_to_school: boolean;
    guardian_id: string | null;
  }>("SELECT id, name, email, role, linked_to_school, guardian_id FROM users ORDER BY created_at ASC");

  const assignments = await query<{ teacher_id: string; subject_name: string }>(
    "SELECT teacher_id, subject_name FROM subject_assignments WHERE grade_level_id = $1",
    [GRADE_LEVEL_ID]
  );
  const subjectsByTeacher = new Map<string, string[]>();
  for (const a of assignments) {
    const list = subjectsByTeacher.get(a.teacher_id) ?? [];
    list.push(a.subject_name);
    subjectsByTeacher.set(a.teacher_id, list);
  }
  // A student points to its guardian via students.guardian_id → build reverse map.
  const studentByGuardian = new Map<string, { id: string; name: string }>();
  for (const u of users) {
    if (u.role === "student" && u.guardian_id) {
      studentByGuardian.set(u.guardian_id, { id: u.id, name: u.name });
    }
  }

  const list = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    linkedToSchool: !!u.linked_to_school,
    subjects: subjectsByTeacher.get(u.id) ?? [],
    linkedStudent: studentByGuardian.get(u.id) ?? null,
  }));
  return NextResponse.json({ users: list });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "link" | "unlink" | "assignSubjects" | "linkGuardian";
    studentId?: string;
    teacherId?: string;
    guardianId?: string;
    subjects?: string[];
  };

  if (body.action === "link" || body.action === "unlink") {
    if (!body.studentId) return NextResponse.json({ error: "studentId required." }, { status: 400 });
    const target = await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1", [body.studentId]);
    if (!target) return NextResponse.json({ error: "Student not found." }, { status: 404 });
    if (body.action === "link") {
      await execute(
        "UPDATE users SET linked_to_school = true, school_id = $1, grade_level_id = $2 WHERE id = $3",
        [SCHOOL_ID, GRADE_LEVEL_ID, body.studentId]
      );
    } else {
      await execute(
        "UPDATE users SET linked_to_school = false, school_id = NULL, grade_level_id = NULL WHERE id = $1",
        [body.studentId]
      );
    }
    await audit("SCHOOL_LINK", `${body.action === "link" ? "Linked" : "Unlinked"} student: ${target.email}`, admin.id);
    return NextResponse.json({ users: await listUsers() });
  }

  if (body.action === "assignSubjects") {
    if (!body.teacherId) return NextResponse.json({ error: "teacherId required." }, { status: 400 });
    const subjects = Array.from(new Set((body.subjects ?? []).map((s) => s.trim()).filter(Boolean)));
    await execute(
      "DELETE FROM subject_assignments WHERE teacher_id = $1 AND grade_level_id = $2",
      [body.teacherId, GRADE_LEVEL_ID]
    );
    for (const subject of subjects) {
      await execute(
        "INSERT INTO subject_assignments (id, teacher_id, subject_name, grade_level_id, created_at) VALUES ($1, $2, $3, $4, $5)",
        [uid("sa"), body.teacherId, subject, GRADE_LEVEL_ID, nowIso()]
      );
    }
    await audit("SCHOOL_ASSIGN_SUBJECTS", `Assigned ${subjects.length} subject(s) to teacher ${body.teacherId}`, admin.id);
    return NextResponse.json({ users: await listUsers() });
  }

  if (body.action === "linkGuardian") {
    if (!body.guardianId || !body.studentId) {
      return NextResponse.json({ error: "guardianId and studentId required." }, { status: 400 });
    }
    const student = await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1", [body.studentId]);
    if (!student) return NextResponse.json({ error: "Student not found." }, { status: 404 });
    await execute("UPDATE users SET guardian_id = $1 WHERE id = $2", [body.guardianId, body.studentId]);
    await audit("SCHOOL_LINK_GUARDIAN", `Linked guardian ${body.guardianId} to student: ${student.email}`, admin.id);
    return NextResponse.json({ users: await listUsers() });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
