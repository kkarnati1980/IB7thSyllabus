import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

// Topic headings live in syllabus_chunks and are keyed to syllabus_files by
// short_name (e.g. "Chemistry") — not the verbose `subject` column.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const subjectName = searchParams.get("subjectName");
    if (!subjectName) return NextResponse.json({ error: "subjectName required" }, { status: 400 });

    // subject_teacher must be assigned to the subject; admin passes for any.
    if (user.role === "subject_teacher") {
      const owns = await queryOne(
        "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
        [user.id, subjectName, GRADE_LEVEL_ID]
      );
      if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await query<{ topic_name: string }>(
      `SELECT DISTINCT sc.heading AS topic_name
         FROM syllabus_files sf
         JOIN syllabus_chunks sc ON sc.file_id = sf.id
        WHERE sf.short_name = $1 AND sc.heading != 'Intro'
        ORDER BY sc.heading`,
      [subjectName]
    );
    return NextResponse.json({ topics: rows });
  } catch (e) {
    console.error("teacher topics GET failed", e);
    return NextResponse.json({ error: "Failed to load topics" }, { status: 500 });
  }
}
