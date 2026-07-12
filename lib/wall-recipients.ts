import type { User } from "@/lib/auth";
import { query } from "@/lib/db";

// Shared recipient scoping for the wall — consumed by GET /api/wall/recipients
// and by POST /api/wall for @mention resolution. Kept out of the route files so
// Next.js route-type validation (which forbids non-handler exports) stays happy.
export type Recipient = { id: string; name: string; role: string; displayName: string };

const COLS = `id, name, role, COALESCE(display_name, name) AS "displayName"`;

export async function getAllowedRecipients(user: User): Promise<Recipient[]> {
  if (user.role === "guardian") return []; // read-only

  if (user.role === "admin") {
    return query<Recipient>(`SELECT ${COLS} FROM users WHERE id <> $1 ORDER BY name`, [user.id]);
  }

  if (user.role === "subject_teacher") {
    return query<Recipient>(
      `SELECT ${COLS} FROM users
        WHERE id <> $1
          AND ( (role = 'student' AND linked_to_school = true)
             OR role = 'grade_teacher'
             OR (role = 'guardian' AND linked_to_school = true) )
        ORDER BY name`,
      [user.id]
    );
  }

  if (user.role === "grade_teacher") {
    return query<Recipient>(
      `SELECT ${COLS} FROM users
        WHERE id <> $1
          AND ( role IN ('grade_teacher', 'subject_teacher')
             OR (role = 'student' AND linked_to_school = true)
             OR (role = 'guardian' AND linked_to_school = true) )
        ORDER BY name`,
      [user.id]
    );
  }

  // student → their grade teacher(s), subject teachers on grade_7_iish, and their own guardian
  return query<Recipient>(
    `SELECT ${COLS} FROM users
      WHERE role = 'grade_teacher'
         OR id IN (SELECT teacher_id FROM subject_assignments WHERE grade_level_id = 'grade_7_iish')
         OR id = $1
      ORDER BY name`,
    [user.guardian_id ?? ""]
  );
}
