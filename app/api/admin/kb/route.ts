import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, ingestFile, nowIso, pool, query, queryOne, uid } from "@/lib/db";
import { getChatClient, messageText } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_CHARS = 12000;

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

// GET ?gradeId=xxx — list syllabus files for a grade with chunk counts.
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const gradeId = new URL(req.url).searchParams.get("gradeId");
  if (!gradeId) return NextResponse.json({ error: "gradeId required" }, { status: 400 });
  const files = await query<{ id: string; name: string; subject: string; short_name: string }>(
    "SELECT id, name, subject, COALESCE(short_name, subject) AS short_name FROM syllabus_files WHERE grade_level_id = $1 ORDER BY created_at ASC",
    [gradeId]
  );
  const result = [];
  for (const f of files) {
    const row = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM syllabus_chunks WHERE file_id = $1", [f.id]);
    result.push({ id: f.id, name: f.name, subject: f.subject, shortName: f.short_name, count: Number(row?.n ?? 0) });
  }
  return NextResponse.json({ files: result });
}

// POST multipart/form-data: file (PDF), gradeId — extract, convert to KB markdown, ingest.
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  const gradeId = String(form.get("gradeId") ?? "");
  if (!(file instanceof Blob) || !gradeId) {
    return NextResponse.json({ error: "file and gradeId required" }, { status: 400 });
  }
  const fileName = (file as File).name || "upload.pdf";
  if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 });

  const grade = await queryOne<{ grade: string }>("SELECT grade FROM grade_levels WHERE id = $1", [gradeId]);
  if (!grade) return NextResponse.json({ error: "Unknown grade" }, { status: 400 });

  const jobId = uid("kbjob");
  const now = nowIso();
  await execute(
    `INSERT INTO kb_upload_jobs (id, grade_level_id, original_filename, status, uploaded_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'processing', $4, $5, $5)`,
    [jobId, gradeId, fileName, user.id, now]
  );

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    // Markdown/text uploads are already structured — ingest directly, skipping
    // PDF extraction and the LLM conversion step.
    const isText = /\.(md|markdown|txt)$/i.test(fileName) || /^text\//.test((file as File).type || "");

    let markdown: string;
    let mdName: string;
    if (isText) {
      markdown = buf.toString("utf8").trim();
      if (!markdown) throw new Error("The uploaded file was empty.");
      mdName = fileName.replace(/\.(markdown|txt)$/i, "");
      if (!/\.md$/i.test(mdName)) mdName += ".md";
    } else {
      // Extract text (import the inner module to avoid pdf-parse's debug harness).
      const mod = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (mod.default ?? mod) as unknown as (b: Buffer) => Promise<{ text: string }>;
      const parsed = await pdfParse(buf);
      const rawText = (parsed.text || "").trim();
      if (!rawText) throw new Error("No extractable text found in the PDF.");

      // Convert to structured markdown via the configured chat LLM.
      const { client, model } = await getChatClient();
      const md = await client.messages.create({
        model,
        max_tokens: 4000,
        system:
          `You are an IB MYP curriculum specialist. Convert the following PDF text into structured markdown ` +
          `knowledge base sections. Each section must have a clear heading (##) and concise educational content ` +
          `suitable for Grade ${grade.grade} IB MYP students. Output ONLY the markdown, no preamble.`,
        messages: [{ role: "user", content: rawText.slice(0, MAX_TEXT_CHARS) }],
      });
      markdown = messageText(md).trim();
      if (!markdown) throw new Error("The chat LLM returned no content.");
      mdName = fileName.replace(/\.pdf$/i, "") + ".md";
    }

    // ingestFile derives the subject from a top-level '# Title'; ensure one exists.
    if (!/^#\s/m.test(markdown)) {
      const base = fileName.replace(/\.(pdf|md|markdown|txt)$/i, "");
      markdown = `# ${base}\n\n${markdown}`;
    }

    const { id: fileId, count } = await ingestFile(mdName, markdown, gradeId);

    await execute(
      "UPDATE kb_upload_jobs SET status = 'done', chunks_created = $2, updated_at = $3 WHERE id = $1",
      [jobId, count, nowIso()]
    );
    return NextResponse.json({ jobId, status: "done", chunksCreated: count, fileName: mdName, fileId });
  } catch (e) {
    const message = (e as Error).message || "Conversion failed";
    await execute(
      "UPDATE kb_upload_jobs SET status = 'failed', error_message = $2, updated_at = $3 WHERE id = $1",
      [jobId, message.slice(0, 500), nowIso()]
    );
    return NextResponse.json({ jobId, status: "failed", error: message }, { status: 500 });
  }
}

// DELETE ?fileId=xxx — remove a syllabus file and its chunks.
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM syllabus_chunks WHERE file_id = $1", [fileId]);
    await client.query("DELETE FROM syllabus_files WHERE id = $1", [fileId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return NextResponse.json({ ok: true });
}
