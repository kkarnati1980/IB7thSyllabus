import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { updateProgress } from "@/lib/progress";

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

  const entry = updateProgress(user.id, {
    topicId: body.topicId,
    topicName: body.topicName,
    subject: body.subject || "",
    icon: body.icon || "📘",
    color: body.color || "#4C43D9",
    masteryDelta: body.masteryDelta || 0,
    misconceptions: body.misconceptions,
  });

  return NextResponse.json({ entry });
}
