import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getUserGradeId } from "@/lib/school";
import { getChatClient, messageText, parseJson } from "@/lib/anthropic";
import { mindMapSystemPrompt } from "@/lib/prompts";
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
  const gradeId = await getUserGradeId(user.id);
  const isTeacher = ["subject_teacher", "grade_teacher"].includes(user.role);
  const chunks = topic ? await retrieve(topic, 4, gradeId) : [];
  const ragCtx = chunks.map((c) => c.text).join("\n");

  try {
    const { client, model } = await getChatClient();
    const message = await client.messages.create({
      model,
      max_tokens: 1000,
      system: mindMapSystemPrompt(subject || "", topic || "", ragCtx, gradeId ?? "grade_7_iish", isTeacher),
      messages: [{ role: "user", content: "Generate the mind map." }],
    });
    const data = parseJson<MindMap>(messageText(message));
    return NextResponse.json({ mindMap: data && data.center ? data : null });
  } catch (err) {
    console.error("mindmap error", err);
    return NextResponse.json({ error: "Could not build mind map." }, { status: 502 });
  }
}
