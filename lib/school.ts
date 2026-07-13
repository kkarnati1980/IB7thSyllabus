import { queryOne } from "./db";

// Whether a student account is linked to a school. Drives all opt-in school-side UI.
export async function isLinkedToSchool(userId: string): Promise<boolean> {
  const row = await queryOne<{ linked_to_school: boolean }>(
    "SELECT linked_to_school FROM users WHERE id = $1",
    [userId]
  );
  return !!row?.linked_to_school;
}

// Resolve the grade whose knowledge base a user should see.
// Teachers and admins get `undefined` (no filter — full cross-grade access);
// school-linked students are scoped to their grade; standalone students to the
// grade chosen at account creation. Falls back to Grade 7 IISH.
export async function getUserGradeId(userId: string): Promise<string | undefined> {
  const row = await queryOne<{
    role: string;
    linked_to_school: boolean | null;
    grade_level_id: string | null;
    standalone_grade_id: string | null;
  }>(
    "SELECT role, linked_to_school, grade_level_id, standalone_grade_id FROM users WHERE id = $1",
    [userId]
  );
  if (!row) return "grade_7_iish";
  if (row.role === "grade_teacher" || row.role === "admin") return undefined;
  if (row.linked_to_school) return row.grade_level_id ?? "grade_7_iish";
  return row.standalone_grade_id ?? "grade_7_iish";
}
