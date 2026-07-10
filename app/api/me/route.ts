import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db, ensureSeed, getSubjects } from "@/lib/db";
import { getProgress } from "@/lib/progress";

export const runtime = "nodejs";

export async function GET() {
  ensureSeed();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  const subjects = getSubjects();
  const progress = getProgress(user.id);
  const chunkCount = (
    db.prepare("SELECT COUNT(*) AS n FROM syllabus_chunks").get() as { n: number }
  ).n;

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    subjects,
    progress,
    chunkCount,
  });
}
