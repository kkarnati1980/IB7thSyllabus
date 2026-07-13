import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, ensureSeed, ingestFile, query, queryOne } from "@/lib/db";
import { getUserGradeId } from "@/lib/school";

export const runtime = "nodejs";

// gradeId undefined → grade teacher / admin: list every grade's files.
async function listFiles(gradeId?: string) {
  const files = await query<{ id: string; name: string; subject: string; short_name: string }>(
    gradeId
      ? "SELECT id, name, subject, COALESCE(short_name, subject) AS short_name FROM syllabus_files WHERE grade_level_id = $1 ORDER BY created_at ASC"
      : "SELECT id, name, subject, COALESCE(short_name, subject) AS short_name FROM syllabus_files ORDER BY created_at ASC",
    gradeId ? [gradeId] : []
  );
  const result = [];
  for (const f of files) {
    const row = await queryOne<{ n: string }>(
      "SELECT COUNT(*) AS n FROM syllabus_chunks WHERE file_id = $1", [f.id]
    );
    result.push({ id: f.id, name: f.name, subject: f.subject, short_name: f.short_name, count: Number(row?.n ?? 0) });
  }
  return result;
}

export async function GET() {
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gradeId = await getUserGradeId(user.id);
  const row = await queryOne<{ n: string }>(
    gradeId
      ? "SELECT COUNT(*) AS n FROM syllabus_chunks WHERE grade_level_id = $1"
      : "SELECT COUNT(*) AS n FROM syllabus_chunks",
    gradeId ? [gradeId] : []
  );
  const chunkCount = Number(row?.n ?? 0);
  return NextResponse.json({ files: await listFiles(gradeId), chunkCount });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    files?: { name: string; text: string }[];
    gradeLevelId?: string;
  };
  if (!body.files || !body.files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  const gradeLevelId = body.gradeLevelId || "grade_7_iish";

  for (const f of body.files) {
    if (!/\.(md|markdown|txt)$/i.test(f.name)) continue;
    await ingestFile(f.name, f.text, gradeLevelId);
  }
  await audit("SYLLABUS_UPLOAD", `${body.files.length} file(s) indexed by ${user.email}`, user.id);

  const row = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM syllabus_chunks");
  const chunkCount = Number(row?.n ?? 0);
  return NextResponse.json({ files: await listFiles(), chunkCount });
}
