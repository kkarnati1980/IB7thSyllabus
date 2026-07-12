import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type User } from "@/lib/auth";
import { execute, nowIso, query, queryOne } from "@/lib/db";
import { getSubjectIBGrade } from "@/lib/myp";

export const runtime = "nodejs";

const GRADE_LEVEL_ID = "grade_7_iish";
const EDIT_ROLES = new Set(["subject_teacher", "grade_teacher", "admin"]);

// Can `user` read assessments for student `userId`?
// subjectName = null means a cross-subject (all=true) request, which subject teachers may not make.
async function canReadStudent(user: User, userId: string, subjectName: string | null): Promise<boolean> {
  if (user.id === userId) return true; // student viewing self
  if (user.role === "admin" || user.role === "grade_teacher") return true;
  if (user.role === "guardian") {
    const ok = await queryOne("SELECT 1 FROM users WHERE id = $1 AND guardian_id = $2", [userId, user.id]);
    return !!ok;
  }
  if (user.role === "subject_teacher" && subjectName) {
    const ok = await queryOne(
      "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
      [user.id, subjectName, GRADE_LEVEL_ID]
    );
    return !!ok;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const scopeSubject = searchParams.get("all") === "true" ? null : searchParams.get("subjectName");
    if (!(await canReadStudent(user, userId, scopeSubject))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (searchParams.get("all") === "true") {
      const configured = await query<{ subject_name: string }>(
        "SELECT DISTINCT subject_name FROM myp_criteria WHERE grade_level_id = $1",
        [GRADE_LEVEL_ID]
      );
      const withData = await query<{ subject_name: string }>(
        "SELECT DISTINCT subject_name FROM myp_assessments WHERE user_id = $1",
        [userId]
      );
      const names = Array.from(
        new Set([...configured.map((r) => r.subject_name), ...withData.map((r) => r.subject_name)])
      ).sort();
      const subjects = [];
      for (const subjectName of names) {
        const g = await getSubjectIBGrade(userId, subjectName);
        subjects.push({ subjectName, overall: g.overall, criteria: g.criteria });
      }
      return NextResponse.json({ subjects });
    }

    const subjectName = searchParams.get("subjectName");
    if (!subjectName) {
      return NextResponse.json({ error: "subjectName or all=true required" }, { status: 400 });
    }
    const assessments = await query(
      `SELECT a.id, a.criterion, a.raw_score, a.overall_1_7, a.suggested_by, a.confirmed,
              a.confirmed_by, a.topic_id, a.topic_name, a.updated_at, c.criterion_name
         FROM myp_assessments a
         LEFT JOIN myp_criteria c
           ON c.subject_name = a.subject_name AND c.criterion = a.criterion AND c.grade_level_id = $3
        WHERE a.user_id = $1 AND a.subject_name = $2
        ORDER BY a.criterion`,
      [userId, subjectName, GRADE_LEVEL_ID]
    );
    return NextResponse.json({ assessments });
  } catch (e) {
    console.error("assessments GET failed", e);
    return NextResponse.json({ error: "Failed to load assessments" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!EDIT_ROLES.has(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      assessmentId?: string;
      rawScore?: number;
      confirmed?: boolean;
    };
    if (!body.assessmentId || typeof body.rawScore !== "number") {
      return NextResponse.json({ error: "assessmentId and rawScore required" }, { status: 400 });
    }
    const target = await queryOne<{ subject_name: string }>(
      "SELECT subject_name FROM myp_assessments WHERE id = $1",
      [body.assessmentId]
    );
    if (!target) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    if (user.role === "subject_teacher") {
      const ok = await queryOne(
        "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = $3",
        [user.id, target.subject_name, GRADE_LEVEL_ID]
      );
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const clamped = Math.max(0, Math.min(8, Math.round(body.rawScore)));
    await execute(
      `UPDATE myp_assessments
          SET raw_score = $1, confirmed = true, confirmed_by = $2, suggested_by = 'teacher', updated_at = $3
        WHERE id = $4`,
      [clamped, user.id, nowIso(), body.assessmentId]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("assessments PATCH failed", e);
    return NextResponse.json({ error: "Failed to update assessment" }, { status: 500 });
  }
}
