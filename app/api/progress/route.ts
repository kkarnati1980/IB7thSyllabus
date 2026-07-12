import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { updateProgress } from "@/lib/progress";
import { masteryToCriterionScore, upsertJarvisAssessment } from "@/lib/myp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    topicId?: string;
    topicName?: string;
    subject?: string;
    icon?: string;
    color?: string;
    masteryDelta?: number;
    misconceptions?: string[];
  };

  if (!body.topicId || !body.topicName) {
    return NextResponse.json({ error: "topicId and topicName required" }, { status: 400 });
  }

  const entry = await updateProgress(user.id, {
    topicId: body.topicId,
    topicName: body.topicName,
    subject: body.subject || "",
    icon: body.icon || "📘",
    color: body.color || "#4C43D9",
    masteryDelta: body.masteryDelta || 0,
    misconceptions: body.misconceptions,
  });

  // Derive a Jarvis MYP grade suggestion for school-linked students. Never let it break the save.
  if (user.linked_to_school && entry.subject) {
    try {
      const score = masteryToCriterionScore(entry.mastery);
      await Promise.all(
        (["A", "B", "C", "D"] as const).map((criterion) =>
          upsertJarvisAssessment(user.id, entry.subject, entry.topicId, entry.topicName, criterion, score)
        )
      );
    } catch (e) {
      console.error("jarvis grading failed", e);
    }
  }

  return NextResponse.json({ entry });
}
