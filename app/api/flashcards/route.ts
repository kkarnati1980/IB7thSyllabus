import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retrieve } from "@/lib/db";
import { getUserGradeId } from "@/lib/school";
import { getClient, MODEL, messageText, parseJson } from "@/lib/anthropic";
import { flashcardsSystemPrompt } from "@/lib/prompts";
import type { Flashcard } from "@/lib/types";

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
  const chunks = topic ? await retrieve(`${topic} vocabulary`, 4, gradeId) : [];
  const ragCtx = chunks.map((c) => c.text).join("\n");

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1600,
      system: flashcardsSystemPrompt(subject || "", topic || "", ragCtx, gradeId ?? "grade_7_iish", isTeacher),
      messages: [{ role: "user", content: "Generate flashcards." }],
    });
    const data = parseJson<Flashcard[] | { flashcards: Flashcard[] }>(messageText(message));
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.flashcards)
        ? data!.flashcards
        : [];
    return NextResponse.json({ items });
  } catch (err) {
    console.error("flashcards error", err);
    return NextResponse.json({ error: "Could not generate flashcards." }, { status: 502 });
  }
}
