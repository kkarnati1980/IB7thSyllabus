import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/session?topicId=xxx — load saved session
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topicId");
  if (!topicId) return NextResponse.json({ error: "topicId required" }, { status: 400 });

  const row = await queryOne<{
    messages: string;
    scaffold: string;
    stage_index: number;
    quiz_data: string;
    quiz_state: string;
    flashcards: string;
    fc_index: number;
    videos: string;
    mindmap: string;
    topic_name: string;
    subject_name: string;
  }>(
    "SELECT * FROM lesson_sessions WHERE user_id = $1 AND topic_id = $2",
    [user.id, topicId]
  );

  if (!row) return NextResponse.json({ session: null });

  return NextResponse.json({
    session: {
      messages: JSON.parse(row.messages || "[]"),
      scaffold: JSON.parse(row.scaffold || "{}"),
      stageIndex: row.stage_index,
      quizData: JSON.parse(row.quiz_data || "[]"),
      quizState: JSON.parse(row.quiz_state || "{}"),
      flashcards: JSON.parse(row.flashcards || "[]"),
      fcIndex: row.fc_index,
      videos: JSON.parse(row.videos || "[]"),
      mindmap: JSON.parse(row.mindmap || "null"),
      topicName: row.topic_name,
      subjectName: row.subject_name,
    },
  });
}

// POST /api/session — save session
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    topicId?: string;
    topicName?: string;
    subjectName?: string;
    messages?: unknown[];
    scaffold?: unknown;
    stageIndex?: number;
    quizData?: unknown[];
    quizState?: unknown;
    flashcards?: unknown[];
    fcIndex?: number;
    videos?: unknown[];
    mindmap?: unknown;
  };

  if (!body.topicId) return NextResponse.json({ error: "topicId required" }, { status: 400 });

  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM lesson_sessions WHERE user_id = $1 AND topic_id = $2",
    [user.id, body.topicId]
  );

  const id = existing?.id ?? uid("ses");
  const now = nowIso();

  await execute(
    `INSERT INTO lesson_sessions
      (id, user_id, topic_id, topic_name, subject_name, messages, scaffold, stage_index,
       quiz_data, quiz_state, flashcards, fc_index, videos, mindmap, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (user_id, topic_id) DO UPDATE SET
       messages=$6, scaffold=$7, stage_index=$8, quiz_data=$9, quiz_state=$10,
       flashcards=$11, fc_index=$12, videos=$13, mindmap=$14, updated_at=$15`,
    [
      id, user.id, body.topicId,
      body.topicName ?? "", body.subjectName ?? "",
      JSON.stringify(body.messages ?? []),
      JSON.stringify(body.scaffold ?? {}),
      body.stageIndex ?? 0,
      JSON.stringify(body.quizData ?? []),
      JSON.stringify(body.quizState ?? {}),
      JSON.stringify(body.flashcards ?? []),
      body.fcIndex ?? 0,
      JSON.stringify(body.videos ?? []),
      JSON.stringify(body.mindmap ?? null),
      now,
    ]
  );

  return NextResponse.json({ ok: true });
}

// DELETE /api/session?topicId=xxx — clear saved session for a topic
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topicId");
  if (!topicId) return NextResponse.json({ error: "topicId required" }, { status: 400 });

  await execute(
    "DELETE FROM lesson_sessions WHERE user_id = $1 AND topic_id = $2",
    [user.id, topicId]
  );

  return NextResponse.json({ ok: true });
}
