import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import GradeTeacherPortal from "@/components/GradeTeacherPortal";

export const dynamic = "force-dynamic";

const GRADE_LEVEL_ID = "grade_7_iish";

export default async function GradeTeacherPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "grade_teacher") redirect("/");

  // Subject Teachers tab is a snapshot loaded server-side — no live editing, so no client route needed.
  const teachers = await query<{ id: string; name: string; email: string }>(
    "SELECT id, name, email FROM users WHERE role = 'subject_teacher' ORDER BY name ASC"
  );
  const assignments = await query<{ teacher_id: string; subject_name: string }>(
    "SELECT teacher_id, subject_name FROM subject_assignments WHERE grade_level_id = $1",
    [GRADE_LEVEL_ID]
  );
  const contentCounts = await query<{ added_by: string; n: string }>(
    "SELECT added_by, COUNT(*) AS n FROM teacher_content GROUP BY added_by"
  );
  const assessedRows = await query<{ subject_name: string; n: string }>(
    "SELECT subject_name, COUNT(DISTINCT user_id) AS n FROM myp_assessments GROUP BY subject_name"
  );

  const contentByTeacher = new Map(contentCounts.map((c) => [c.added_by, Number(c.n)]));
  const assessedBySubject: Record<string, number> = {};
  for (const r of assessedRows) assessedBySubject[r.subject_name] = Number(r.n);

  const subjectTeachers = teachers.map((t) => ({
    id: t.id,
    name: t.name,
    email: t.email,
    subjects: assignments.filter((a) => a.teacher_id === t.id).map((a) => a.subject_name).sort(),
    contentCount: contentByTeacher.get(t.id) ?? 0,
  }));

  return (
    <GradeTeacherPortal
      user={{ id: user.id, name: user.name, email: user.email }}
      subjectTeachers={subjectTeachers}
      assessedBySubject={assessedBySubject}
    />
  );
}
