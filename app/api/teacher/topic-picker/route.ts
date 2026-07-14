import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne, topicHierarchy } from "@/lib/db";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

// GET /api/teacher/topic-picker?subjectName=Chemistry — 3-level hierarchy for one subject.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const subjectName = new URL(req.url).searchParams.get("subjectName");
  if (!subjectName) return NextResponse.json({ error: "subjectName required" }, { status: 400 });

  // subject_teacher must own the subject; admin passes for any.
  if (user.role === "subject_teacher") {
    const owns = await queryOne(
      "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
      [user.id, subjectName, GRADE_LEVEL_ID]
    );
    if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const subjects = await topicHierarchy(subjectName);
  return NextResponse.json({ subjects });
}
