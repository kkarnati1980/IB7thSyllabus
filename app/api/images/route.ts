import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/images?topicName=xxx&subjectName=yyy
// Students only see approved images; admin sees all
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicName = searchParams.get("topicName") ?? "";
  const subjectName = searchParams.get("subjectName") ?? "";
  const all = searchParams.get("all") === "true"; // admin param to see all statuses

  let sql = "SELECT id, image_url, thumbnail_url, alt_text, source, status FROM topic_images WHERE topic_name = $1 AND subject_name = $2";
  const params: unknown[] = [topicName, subjectName];

  if (!all || user.role !== "admin") {
    sql += " AND status = 'approved'";
  }
  sql += " ORDER BY created_at ASC";

  const images = await query<{
    id: string;
    image_url: string;
    thumbnail_url: string;
    alt_text: string;
    source: string;
    status: string;
  }>(sql, params);

  return NextResponse.json({ images });
}

// POST /api/images — admin generates/saves images
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    topicName?: string;
    subjectName?: string;
    action?: "web" | "ai" | "manual" | "approve" | "reject";
    imageUrl?: string;
    altText?: string;
    imageId?: string;
  };

  if (!body.topicName || !body.subjectName) {
    return NextResponse.json({ error: "topicName and subjectName required" }, { status: 400 });
  }

  // Approve / reject existing image
  if (body.action === "approve" || body.action === "reject") {
    if (!body.imageId) return NextResponse.json({ error: "imageId required" }, { status: 400 });
    const status = body.action === "approve" ? "approved" : "rejected";
    await execute("UPDATE topic_images SET status = $1 WHERE id = $2", [status, body.imageId]);
    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source, status FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  if (body.action === "manual" && body.imageUrl) {
    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)",
      [id, body.topicName, body.subjectName, body.imageUrl, body.imageUrl, body.altText ?? body.topicName, "manual", nowIso()]
    );
    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source, status FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  if (body.action === "web") {
    // Use Unsplash source URL (no API key needed)
    const q = encodeURIComponent(`${body.topicName} ${body.subjectName} education IB MYP Grade 7`);
    const seed = Date.now(); // different seed each time for variety
    const imageUrl = `https://source.unsplash.com/800x500/?${q}&sig=${seed}`;
    const thumbnailUrl = `https://source.unsplash.com/400x250/?${q}&sig=${seed}`;

    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'web','pending',$7)",
      [id, body.topicName, body.subjectName, imageUrl, thumbnailUrl, `${body.topicName} — educational image`, nowIso()]
    );
    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source, status FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  if (body.action === "ai") {
    const apiKeyRow = await queryOne<{ value: string }>(
      "SELECT value FROM app_config WHERE key = 'openai_api_key'"
    );
    if (!apiKeyRow?.value) {
      return NextResponse.json({ error: "OpenAI API key not configured. Add it in Admin → Config & API Keys." }, { status: 400 });
    }

    const prompt = `A clean, colorful educational illustration for Grade 7 IB MYP ${body.subjectName}: ${body.topicName}. Clear diagram style suitable for a 12-year-old student. Scientific accuracy. White background. No text overlays.`;

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyRow.value}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json(
        { error: `OpenAI error: ${err.error?.message ?? "Generation failed. Ensure your OpenAI account has DALL-E 3 access."}` },
        { status: 502 }
      );
    }

    const data = await res.json() as { data: { url: string }[] };
    const imageUrl = data.data[0]?.url;
    if (!imageUrl) return NextResponse.json({ error: "No image returned from OpenAI" }, { status: 502 });

    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'ai','pending',$7)",
      [id, body.topicName, body.subjectName, imageUrl, imageUrl, `AI illustration: ${body.topicName}`, nowIso()]
    );

    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source, status FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/images?id=xxx
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await execute("DELETE FROM topic_images WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
