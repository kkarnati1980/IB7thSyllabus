import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { sumToIBGrade } from "@/lib/myp";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

// Grade-teacher grid: every linked student x every configured subject, cell = overall IB 1-7.
// Shape: { students: [{id,name}], subjects: [subjectName...], grid: {[studentId]: {[subjectName]: overall}} }
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "grade_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const students = await query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE role = 'student' AND linked_to_school = true ORDER BY name ASC"
    );
    const subjectRows = await query<{ subject_name: string }>(
      "SELECT DISTINCT subject_name FROM myp_criteria WHERE grade_level_id = $1 ORDER BY subject_name ASC",
      [GRADE_LEVEL_ID]
    );
    const subjects = subjectRows.map((r) => r.subject_name);

    const grid: Record<string, Record<string, number>> = {};
    for (const s of students) grid[s.id] = {};

    if (students.length) {
      // One aggregate: sum of the best (max) raw score per A-D criterion, per student per subject.
      // Mirrors getSubjectIBGrade() but for the whole grade in a single round-trip.
      const totals = await query<{ user_id: string; subject_name: string; total: string | number }>(
        `SELECT user_id, subject_name, SUM(m) AS total FROM (
           SELECT user_id, subject_name, criterion, MAX(raw_score) AS m
             FROM myp_assessments
            WHERE user_id = ANY($1) AND criterion IN ('A','B','C','D')
            GROUP BY user_id, subject_name, criterion
         ) t
         GROUP BY user_id, subject_name`,
        [students.map((s) => s.id)]
      );
      for (const t of totals) {
        if (!grid[t.user_id]) continue;
        grid[t.user_id][t.subject_name] = sumToIBGrade(Number(t.total) || 0);
      }
    }

    return NextResponse.json({ students, subjects, grid });
  } catch (e) {
    console.error("grade-teacher overview GET failed", e);
    return NextResponse.json({ error: "Failed to load overview" }, { status: 500 });
  }
}
