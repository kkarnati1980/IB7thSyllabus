import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { topicContext, videosSystemPrompt } from "@/lib/prompts";
import type { VideoItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, topic } = (await req.json().catch(() => ({}))) as {
    subject?: string;
    topic?: string;
  };

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: videosSystemPrompt(topicContext(subject || "", topic || "")),
      messages: [{ role: "user", content: "Generate video recommendations." }],
    });
    const data = parseJson<VideoItem[] | { videos: VideoItem[] }>(messageText(message));
    const items = Array.isArray(data) ? data : Array.isArray(data?.videos) ? data!.videos : [];
    return NextResponse.json({ items });
  } catch (err) {
    console.error("videos error", err);
    return NextResponse.json({ error: "Could not find videos." }, { status: 502 });
  }
}
