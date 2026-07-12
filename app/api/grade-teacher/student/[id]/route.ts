import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { sumToIBGrade } from "@/lib/myp";

export const runtime = "nodejs";

type AssessmentRow = {
  subject_name: string;
  topic_id: string;
  topic_name: string;
  criterion: string;
  raw_score: number;
};

type TopicDetail = {
  topicId: string;
  topicName: string;
  criteria: Record<string, number>; // criterion -> raw score (0-8)
  overall: number; // IB 1-7 from this topic's criteria sum
};

type SubjectDetail = {
  subjectName: string;
  overall: number; // IB 1-7 from best-per-criterion sum (matches getSubjectIBGrade)
  criteria: { A: number; B: number; C: number; D: number };
  topics: TopicDetail[];
};

// Full profile for one student: per-subject overall + per-topic criterion scores, plus unresolved flags.
// Shape: { student:{id,name}, subjects: SubjectDetail[], flags: [{id,topicName,subjectName,reason,createdAt}] }
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "grade_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const student = await queryOne<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE id = $1 AND role = 'student'",
      [id]
    );
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    const rows = await query<AssessmentRow>(
      `SELECT subject_name, topic_id, topic_name, criterion, raw_score
         FROM myp_assessments WHERE user_id = $1
        ORDER BY subject_name, topic_name, criterion`,
      [id]
    );

    const bySubject = new Map<string, { topics: Map<string, TopicDetail> }>();
    for (const r of rows) {
      let subj = bySubject.get(r.subject_name);
      if (!subj) {
        subj = { topics: new Map() };
        bySubject.set(r.subject_name, subj);
      }
      let topic = subj.topics.get(r.topic_id);
      if (!topic) {
        topic = { topicId: r.topic_id, topicName: r.topic_name, criteria: {}, overall: 1 };
        subj.topics.set(r.topic_id, topic);
      }
      topic.criteria[r.criterion] = r.raw_score;
    }

    const subjects: SubjectDetail[] = [];
    for (const [subjectName, s] of bySubject) {
      const best: Record<string, number> = {};
      const topics: TopicDetail[] = [];
      for (const topic of s.topics.values()) {
        let topicSum = 0;
        for (const c of ["A", "B", "C", "D"]) {
          const v = topic.criteria[c] ?? 0;
          topicSum += v;
          if (v > (best[c] ?? 0)) best[c] = v;
        }
        topic.overall = sumToIBGrade(topicSum);
        topics.push(topic);
      }
      const criteria = { A: best.A ?? 0, B: best.B ?? 0, C: best.C ?? 0, D: best.D ?? 0 };
      const overall = sumToIBGrade(criteria.A + criteria.B + criteria.C + criteria.D);
      subjects.push({ subjectName, overall, criteria, topics });
    }
    subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const flags = await query<{
      id: string;
      topic_name: string;
      subject_name: string;
      reason: string;
      created_at: string;
    }>(
      `SELECT id, topic_name, subject_name, reason, created_at
         FROM topic_flags WHERE user_id = $1 AND resolved = false
        ORDER BY created_at DESC`,
      [id]
    );

    return NextResponse.json({
      student,
      subjects,
      flags: flags.map((f) => ({
        id: f.id,
        topicName: f.topic_name,
        subjectName: f.subject_name,
        reason: f.reason,
        createdAt: f.created_at,
      })),
    });
  } catch (e) {
    console.error("grade-teacher student GET failed", e);
    return NextResponse.json({ error: "Failed to load student" }, { status: 500 });
  }
}
