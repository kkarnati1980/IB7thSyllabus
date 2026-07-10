import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, db, ensureSeed, ingestFile } from "@/lib/db";

export const runtime = "nodejs";

function listFiles() {
  const files = db
    .prepare("SELECT id, name, subject FROM syllabus_files ORDER BY created_at ASC")
    .all() as { id: string; name: string; subject: string }[];
  return files.map((f) => {
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM syllabus_chunks WHERE file_id = ?").get(f.id) as {
        n: number;
      }
    ).n;
    return { id: f.id, name: f.name, subject: f.subject, count };
  });
}

export async function GET() {
  ensureSeed();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const chunkCount = (
    db.prepare("SELECT COUNT(*) AS n FROM syllabus_chunks").get() as { n: number }
  ).n;
  return NextResponse.json({ files: listFiles(), chunkCount });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    files?: { name: string; text: string }[];
  };
  if (!body.files || !body.files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  for (const f of body.files) {
    if (!/\.(md|markdown|txt)$/i.test(f.name)) continue;
    ingestFile(f.name, f.text);
  }
  audit("SYLLABUS_UPLOAD", `${body.files.length} file(s) indexed by ${user.email}`, user.id);

  const chunkCount = (
    db.prepare("SELECT COUNT(*) AS n FROM syllabus_chunks").get() as { n: number }
  ).n;
  return NextResponse.json({ files: listFiles(), chunkCount });
}
