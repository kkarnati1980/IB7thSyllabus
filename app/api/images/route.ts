import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/images?topicName=xxx&subjectName=yyy
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicName = searchParams.get("topicName") ?? "";
  const subjectName = searchParams.get("subjectName") ?? "";

  const images = await query<{
    id: string;
    image_url: string;
    thumbnail_url: string;
    alt_text: string;
    source: string;
  }>(
    "SELECT id, image_url, thumbnail_url, alt_text, source FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
    [topicName, subjectName]
  );

  return NextResponse.json({ images });
}

// POST /api/images — admin generates/saves images for a topic
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    topicName?: string;
    subjectName?: string;
    action?: "web" | "ai" | "manual";
    imageUrl?: string;
    altText?: string;
  };

  if (!body.topicName || !body.subjectName) {
    return NextResponse.json({ error: "topicName and subjectName required" }, { status: 400 });
  }

  if (body.action === "manual" && body.imageUrl) {
    // Manual URL save
    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, body.topicName, body.subjectName, body.imageUrl, body.imageUrl, body.altText ?? body.topicName, "manual", nowIso()]
    );
    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  if (body.action === "web") {
    // Web search via Unsplash (no API key needed for source URL approach)
    const searchQuery = encodeURIComponent(`${body.topicName} ${body.subjectName} education science`);
    const unsplashUrl = `https://source.unsplash.com/800x500/?${searchQuery}`;
    const thumbnailUrl = `https://source.unsplash.com/400x250/?${searchQuery}`;

    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, body.topicName, body.subjectName, unsplashUrl, thumbnailUrl, `${body.topicName} - educational image`, "web", nowIso()]
    );
    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  if (body.action === "ai") {
    // OpenAI DALL-E image generation
    const apiKeyRow = await queryOne<{ value: string }>(
      "SELECT value FROM app_config WHERE key = 'openai_api_key'"
    );
    if (!apiKeyRow?.value) {
      return NextResponse.json({ error: "OpenAI API key not configured. Add it in Admin → Config." }, { status: 400 });
    }

    const prompt = `Educational illustration for Grade 7 IB MYP ${body.subjectName}: ${body.topicName}. Clean, clear, colorful diagram suitable for a 12-year-old student. No text labels.`;

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
      return NextResponse.json({ error: err.error?.message ?? "DALL-E generation failed" }, { status: 502 });
    }

    const data = await res.json() as { data: { url: string }[] };
    const imageUrl = data.data[0]?.url;
    if (!imageUrl) return NextResponse.json({ error: "No image returned" }, { status: 502 });

    const id = uid("img");
    await execute(
      "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, body.topicName, body.subjectName, imageUrl, imageUrl, `AI illustration: ${body.topicName}`, "ai", nowIso()]
    );

    const images = await query(
      "SELECT id, image_url, thumbnail_url, alt_text, source FROM topic_images WHERE topic_name = $1 AND subject_name = $2 ORDER BY created_at ASC",
      [body.topicName, body.subjectName]
    );
    return NextResponse.json({ images });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/images?id=xxx — remove a specific image
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
