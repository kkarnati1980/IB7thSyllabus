import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

type ChannelRow = {
  id: string;
  channel_name: string;
  channel_keywords: string;
  grade_level_id: string | null;
  added_by: string | null;
  created_at: string;
};

function effectiveGrade(gradeLevelId?: string | null): string {
  return gradeLevelId || "grade_7_iish";
}

// GET — global defaults (grade_level_id IS NULL) plus channels scoped to the caller's grade.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const grade = effectiveGrade(user.grade_level_id);
  const channels = await query<ChannelRow>(
    `SELECT id, channel_name, channel_keywords, grade_level_id, added_by, created_at
       FROM allowed_video_channels
      WHERE grade_level_id IS NULL OR grade_level_id = $1
      ORDER BY added_by IS NOT NULL, channel_name ASC`,
    [grade]
  );
  return NextResponse.json({ channels });
}

// POST — grade teachers / admins add a channel scoped to their grade.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "grade_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { channelName, channelKeywords } = (await req.json().catch(() => ({}))) as {
    channelName?: string;
    channelKeywords?: string;
  };
  if (!channelName?.trim() || !channelKeywords?.trim()) {
    return NextResponse.json({ error: "channelName and channelKeywords required" }, { status: 400 });
  }
  const id = uid("chan");
  await execute(
    `INSERT INTO allowed_video_channels (id, channel_name, channel_keywords, grade_level_id, added_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, channelName.trim(), channelKeywords.trim().toLowerCase(), user.grade_level_id ?? null, user.id, nowIso()]
  );
  return NextResponse.json({ ok: true, id });
}

// DELETE — grade teachers / admins remove a channel, but never the built-in defaults.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "grade_teacher" && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = await queryOne<{ added_by: string | null }>(
    "SELECT added_by FROM allowed_video_channels WHERE id = $1",
    [id]
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.added_by === null) {
    return NextResponse.json({ error: "Default channels cannot be deleted." }, { status: 403 });
  }
  await execute("DELETE FROM allowed_video_channels WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
