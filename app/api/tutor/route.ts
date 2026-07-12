import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { tutorSystemPrompt } from "@/lib/prompts";
import { trackerSummary, updateProgress } from "@/lib/progress";
import type { Scaffold, TutorTurn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type RawTutor = {
  say?: string;
  stage?: number;
  concept_map?: {
    core?: string;
    key_concepts?: string[];
    keyConcepts?: string[];
    related?: string[];
    vocab?: string[];
    applications?: string[];
  };
  inquiry?: string[];
  layers?: { level: number; title: string; text: string }[];
  ib?: { key?: string; related?: string; global?: string; soi?: string; atl?: string[] };
  misconceptions?: { think: string; why: string }[];
  checkpoint?: { level: number; question: string };
  mastery_delta?: number;
  reflection?: string[];
  reinforcement?: {
    summary?: string;
    application?: string;
    challenge?: string;
    trick?: string;
    tip?: string;
  };
};

function mergeScaffold(prev: Scaffold, d: RawTutor): Scaffold {
  const sc: Scaffold = { ...prev };
  if (d.concept_map && d.concept_map.core) {
    const c = d.concept_map;
    sc.cm = {
      core: c.core || "",
      keyConcepts: c.key_concepts || c.keyConcepts || [],
      related: c.related || [],
      vocab: c.vocab || [],
      applications: c.applications || [],
    };
  }
  if (d.inquiry?.length) sc.inquiry = d.inquiry;
  if (d.layers?.length) sc.layers = d.layers;
  if (d.ib && (d.ib.key || d.ib.soi))
    sc.ib = {
      key: d.ib.key || "",
      related: d.ib.related || "",
      global: d.ib.global || "",
      soi: d.ib.soi || "",
      atl: d.ib.atl || [],
    };
  if (d.misconceptions?.length) sc.miscon = d.misconceptions;
  if (d.checkpoint && d.checkpoint.question) sc.checkpoint = d.checkpoint;
  if (d.reinforcement && d.reinforcement.summary)
    sc.reinf = {
      summary: d.reinforcement.summary || "",
      application: d.reinforcement.application || "",
      challenge: d.reinforcement.challenge || "",
      trick: d.reinforcement.trick || "",
      tip: d.reinforcement.tip || "",
    };
  if (d.reflection?.length) sc.reflection = d.reflection;
  return sc;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    kick?: string;
    userText?: string;
    history?: { role: "user" | "jarvis"; text: string }[];
    scaffold?: Scaffold;
    topic?: { id: string; name: string };
    subject?: { name: string; icon: string; color: string };
  };

  const topicName = body.topic?.name || "";
  const subjectName = body.subject?.name || "";
  const history = body.history || [];

  const query = (topicName ? topicName + " " : "") + (body.userText || body.kick || "");
  const chunks = await retrieve(query);
  const ctx = chunks.map((c) => `[${c.file} › ${c.heading}] ${c.text}`).join("\n\n");

  const summary = await trackerSummary(user.id);

  const convo: { role: "user" | "assistant"; content: string }[] = history.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("assistant" as const),
    content: m.text,
  }));
  if (body.kick) convo.push({ role: "user", content: body.kick });
  else if (body.userText) convo.push({ role: "user", content: body.userText });

  let raw: string;
  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1600,
      system: tutorSystemPrompt(topicName, subjectName, ctx, summary),
      messages: convo,
    });
    raw = messageText(message);
  } catch (err) {
    console.error("tutor error", err);
    return NextResponse.json(
      { error: "I had trouble thinking just now — could you say that again?" },
      { status: 502 }
    );
  }

  const data = parseJson<RawTutor>(raw) || { say: raw };
  const say = data.say || raw || "Let's keep going — tell me more about what you're thinking.";
  const scaffold = mergeScaffold(body.scaffold || {}, data);
  const stage = typeof data.stage === "number" ? data.stage : undefined;
  const masteryDelta = data.mastery_delta || 0;

  if (body.topic) {
    await updateProgress(user.id, {
      topicId: body.topic.id,
      topicName: body.topic.name,
      subject: subjectName,
      icon: body.subject?.icon || "📘",
      color: body.subject?.color || "#4C43D9",
      masteryDelta,
      misconceptions: (data.misconceptions || []).map((m) => m.think).filter(Boolean),
    });
  }

  const turn: TutorTurn = { say, stage, scaffold, masteryDelta };
  return NextResponse.json(turn);
}
