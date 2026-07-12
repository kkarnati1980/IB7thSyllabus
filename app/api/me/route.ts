import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeed, getSubjects, queryOne } from "@/lib/db";
import { getProgress } from "@/lib/progress";

export const runtime = "nodejs";

export async function GET() {
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  const subjects = await getSubjects();
  const progress = await getProgress(user.id);
  const row = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM syllabus_chunks");
  const chunkCount = Number(row?.n ?? 0);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, linkedToSchool: !!user.linked_to_school },
    subjects,
    progress,
    chunkCount,
  });
}
