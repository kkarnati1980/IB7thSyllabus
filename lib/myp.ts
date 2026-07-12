import { execute, query, uid, nowIso } from "./db";

export function sumToIBGrade(sum: number): number {
  if (sum === 0) return 1;
  if (sum <= 5) return 2;
  if (sum <= 9) return 3;
  if (sum <= 13) return 4;
  if (sum <= 17) return 5;
  if (sum <= 21) return 6;
  return 7;
}

export function masteryToCriterionScore(masteryPct: number): number {
  const b = [12, 25, 37, 50, 62, 74, 87, 100];
  const i = b.findIndex((x) => masteryPct <= x);
  return i < 0 ? 8 : i; // 0..8; clamp so >100 → 8
}

export type CriterionRow = { criterion: string; criterion_name: string; max_score: number };

// ponytail: Sciences criteria are the IB MYP default fallback when a subject has no configured rows
const SCIENCES_DEFAULT: CriterionRow[] = [
  { criterion: "A", criterion_name: "Knowing and Understanding", max_score: 8 },
  { criterion: "B", criterion_name: "Inquiring and Designing", max_score: 8 },
  { criterion: "C", criterion_name: "Processing and Evaluating", max_score: 8 },
  { criterion: "D", criterion_name: "Reflecting on the Impacts", max_score: 8 },
];

export async function getCriteriaForSubject(
  subjectName: string,
  gradeLevelId: string
): Promise<CriterionRow[]> {
  try {
    const rows = await query<CriterionRow>(
      `SELECT criterion, criterion_name, max_score FROM myp_criteria
        WHERE subject_name = $1 AND grade_level_id = $2 ORDER BY criterion`,
      [subjectName, gradeLevelId]
    );
    return rows.length ? rows : SCIENCES_DEFAULT;
  } catch {
    return SCIENCES_DEFAULT;
  }
}

export async function upsertJarvisAssessment(
  userId: string,
  subjectName: string,
  topicId: string,
  topicName: string,
  criterion: string,
  rawScore: number
): Promise<void> {
  const clamped = Math.max(0, Math.min(8, Math.round(rawScore)));
  // DO UPDATE only fires when the existing row is still an unconfirmed jarvis suggestion,
  // so teacher-confirmed/edited scores are never clobbered.
  await execute(
    `INSERT INTO myp_assessments
       (id, user_id, subject_name, topic_id, topic_name, criterion, raw_score, suggested_by, confirmed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'jarvis', false, $8)
     ON CONFLICT (user_id, topic_id, criterion) DO UPDATE SET
       raw_score = EXCLUDED.raw_score,
       topic_name = EXCLUDED.topic_name,
       subject_name = EXCLUDED.subject_name,
       updated_at = EXCLUDED.updated_at
     WHERE myp_assessments.confirmed = false AND myp_assessments.suggested_by = 'jarvis'`,
    [uid("mas"), userId, subjectName, topicId, topicName, criterion, clamped, nowIso()]
  );
}

export type SubjectIBGrade = {
  overall: number;
  criteria: { A: number; B: number; C: number; D: number };
};

export async function getSubjectIBGrade(
  userId: string,
  subjectName: string
): Promise<SubjectIBGrade> {
  const rows = await query<{ criterion: string; max: string | number }>(
    `SELECT criterion, MAX(raw_score) AS max FROM myp_assessments
      WHERE user_id = $1 AND subject_name = $2 GROUP BY criterion`,
    [userId, subjectName]
  );
  const criteria: SubjectIBGrade["criteria"] = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of rows) {
    if (r.criterion === "A" || r.criterion === "B" || r.criterion === "C" || r.criterion === "D") {
      criteria[r.criterion] = Number(r.max) || 0;
    }
  }
  const sum = criteria.A + criteria.B + criteria.C + criteria.D;
  return { overall: sumToIBGrade(sum), criteria };
}
