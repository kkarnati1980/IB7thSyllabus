import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { mindMapSystemPrompt, topicContext } from "@/lib/prompts";
import type { MindMap } from "@/lib/types";

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
    ? retrieve(topic)
        .map((c) => c.text)
        .join("\n")
    : "";

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: mindMapSystemPrompt(topicContext(subject || "", topic || ""), ragCtx),
      messages: [{ role: "user", content: "Generate the mind map." }],
    });
    const data = parseJson<MindMap>(messageText(message));
    return NextResponse.json({ mindMap: data && data.center ? data : null });
  } catch (err) {
    console.error("mindmap error", err);
    return NextResponse.json({ error: "Could not build mind map." }, { status: 502 });
  }
}
