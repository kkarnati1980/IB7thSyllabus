import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getClient, MODEL, messageText } from "@/lib/anthropic";
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

// Robustly parse JSON from LLM output — handles code fences, leading text, etc.
function parseJson<T>(raw: string): T | null {
  if (!raw) return null;
  // Strip markdown code fences
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Find first { and last }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// Extract just the "say" field safely without full parse
function extractSay(raw: string): string | null {
  try {
    // Try regex extraction of say field as fallback
    const match = raw.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) return match[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  } catch { /* ignore */ }
  return null;
}

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

// Check if text looks like raw JSON (starts with { and contains "say":)
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") && t.includes('"say"');
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

  const queryStr = (topicName ? topicName + " " : "") + (body.userText || body.kick || "");
  const chunks = await retrieve(queryStr);
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

  // Parse the JSON response
  const data = parseJson<RawTutor>(raw);

  let say: string;
  if (data?.say) {
    // Happy path — full parse succeeded and say is present
    say = data.say;
  } else if (looksLikeJson(raw)) {
    // Full parse failed but it looks like JSON — try regex extraction of say
    const extracted = extractSay(raw);
    say = extracted || "Let me think about that differently — could you tell me more about what you're wondering?";
  } else {
    // LLM returned plain text (shouldn't happen but handle gracefully)
    say = raw.slice(0, 300);
  }

  // Final safety net — never show raw JSON in chat
  if (looksLikeJson(say)) {
    const extracted = extractSay(say);
    say = extracted || "Let's keep going — tell me more about what you're thinking.";
  }

  const scaffold = mergeScaffold(body.scaffold || {}, data || {});
  const stage = typeof data?.stage === "number" ? data.stage : undefined;
  const masteryDelta = data?.mastery_delta || 0;

  if (body.topic) {
    await updateProgress(user.id, {
      topicId: body.topic.id,
      topicName: body.topic.name,
      subject: subjectName,
      icon: body.subject?.icon || "📘",
      color: body.subject?.color || "#4C43D9",
      masteryDelta,
      misconceptions: (data?.misconceptions || []).map((m) => m.think).filter(Boolean),
    });
  }

  const turn: TutorTurn = { say, stage, scaffold, masteryDelta };
  return NextResponse.json(turn);
}
