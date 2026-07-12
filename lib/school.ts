import { queryOne } from "./db";

// Whether a student account is linked to a school. Drives all opt-in school-side UI.
export async function isLinkedToSchool(userId: string): Promise<boolean> {
  const row = await queryOne<{ linked_to_school: boolean }>(
    "SELECT linked_to_school FROM users WHERE id = $1",
    [userId]
  );
  return !!row?.linked_to_school;
}
