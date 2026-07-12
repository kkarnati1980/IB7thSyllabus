import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getSubjectIBGrade } from "@/lib/myp";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const subjectRows = await query<{ subject_name: string }>(
      "SELECT subject_name FROM subject_assignments WHERE teacher_id = $1 AND grade_level_id = $2 ORDER BY subject_name",
      [user.id, GRADE_LEVEL_ID]
    );
    const subjects = subjectRows.map((r) => r.subject_name);

    const studentRows = await query<{ id: string; name: string; display_name: string | null }>(
      `SELECT id, name, display_name FROM users
        WHERE role = 'student' AND linked_to_school = true
        ORDER BY COALESCE(display_name, name)`
    );

    const students = [];
    for (const s of studentRows) {
      const grades: Record<string, number> = {};
      for (const subjectName of subjects) {
        const g = await getSubjectIBGrade(s.id, subjectName);
        grades[subjectName] = g.overall;
      }
      students.push({ id: s.id, name: s.display_name || s.name, grades });
    }

    return NextResponse.json({ students, subjects });
  } catch (e) {
    console.error("teacher students GET failed", e);
    return NextResponse.json({ error: "Failed to load students" }, { status: 500 });
  }
}
