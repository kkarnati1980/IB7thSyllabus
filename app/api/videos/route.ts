import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserGradeId } from "@/lib/school";
import { filterVideos } from "@/lib/guardrails";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { videosSystemPrompt } from "@/lib/prompts";
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
  const gradeId = (await getUserGradeId(user.id)) ?? "grade_7_iish";
  const isTeacher = ["subject_teacher", "grade_teacher"].includes(user.role);

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      system: videosSystemPrompt(subject || "", topic || "", gradeId, isTeacher),
      messages: [{ role: "user", content: "Generate video recommendations." }],
    });
    const data = parseJson<VideoItem[] | { videos: VideoItem[] }>(messageText(message));
    const items = Array.isArray(data) ? data : Array.isArray(data?.videos) ? data!.videos : [];
    // Enforce the channel whitelist server-side — the prompt asks nicely, this guarantees it.
    const allowed = await filterVideos(items, gradeId);
    if (allowed.length === 0) {
      return NextResponse.json({
        items: [],
        message: "No videos from approved channels were found for this topic. Try again shortly.",
      });
    }
    return NextResponse.json({ items: allowed });
  } catch (err) {
    console.error("videos error", err);
    return NextResponse.json({ error: "Could not find videos." }, { status: 502 });
  }
}
