import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { quizSystemPrompt, topicContext } from "@/lib/prompts";
import type { QuizItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, topic } = (await req.json().catch(() => ({}))) as {
    subject?: string;
    topic?: string;
  };
  const ragCtx = topic
    ? retrieve(`${topic} quiz`)
        .map((c) => c.text)
        .join("\n")
    : "";

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1800,
      system: quizSystemPrompt(topicContext(subject || "", topic || ""), ragCtx),
      messages: [{ role: "user", content: "Generate the quiz now." }],
    });
    const data = parseJson<QuizItem[] | { questions: QuizItem[] }>(messageText(message));
    const items = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data!.questions : [];
    return NextResponse.json({ items });
  } catch (err) {
    console.error("quiz error", err);
    return NextResponse.json({ error: "Could not generate quiz." }, { status: 502 });
  }
}
