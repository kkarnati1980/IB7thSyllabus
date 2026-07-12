import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const subjectName = new URL(req.url).searchParams.get("subjectName");
    if (!subjectName) return NextResponse.json({ error: "subjectName required" }, { status: 400 });
    if (user.role === "subject_teacher") {
      const ok = await queryOne(
        "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
        [user.id, subjectName, GRADE_LEVEL_ID]
      );
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const criteria = await query(
      `SELECT id, subject_name, criterion, criterion_name, max_score
         FROM myp_criteria WHERE subject_name = $1 AND grade_level_id = $2 ORDER BY criterion`,
      [subjectName, GRADE_LEVEL_ID]
    );
    return NextResponse.json({ criteria });
  } catch (e) {
    console.error("teacher criteria GET failed", e);
    return NextResponse.json({ error: "Failed to load criteria" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "subject_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; criterionName?: string };
    if (!body.id || !body.criterionName?.trim()) {
      return NextResponse.json({ error: "id and criterionName required" }, { status: 400 });
    }
    const row = await queryOne<{ subject_name: string }>(
      "SELECT subject_name FROM myp_criteria WHERE id = $1 AND grade_level_id = $2",
      [body.id, GRADE_LEVEL_ID]
    );
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (user.role === "subject_teacher") {
      const ok = await queryOne(
        "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
        [user.id, row.subject_name, GRADE_LEVEL_ID]
      );
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await execute("UPDATE myp_criteria SET criterion_name = $1 WHERE id = $2", [
      body.criterionName.trim(),
      body.id,
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("teacher criteria PATCH failed", e);
    return NextResponse.json({ error: "Failed to update criterion" }, { status: 500 });
  }
}
