import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { topicHierarchy } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/admin/topic-picker — full 3-level hierarchy (Subject → Chapter → Topic).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const subjects = await topicHierarchy();
  return NextResponse.json({ subjects });
}
