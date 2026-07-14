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
    // Wikipedia pageimages needs no API key and returns a real thumbnail per title.
    // source.unsplash.com is deprecated and now returns nothing.
    // Look the topic heading up directly (e.g. "Concept: The Atom"), not the file/subject.
    let imageUrl = "";
    let thumbnailUrl = "";
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(body.topicName)}&prop=pageimages&format=json&pithumbsize=800&origin=*`
      );
      if (wikiRes.ok) {
        const data = (await wikiRes.json()) as { query?: { pages?: Record<string, { thumbnail?: { source?: string } }> } };
        const pages = Object.values(data.query?.pages ?? {});
        const thumb = pages[0]?.thumbnail?.source;
        if (thumb) {
          imageUrl = thumb;
          thumbnailUrl = thumb.replace(/\/\d+px-/, "/400px-"); // smaller thumbnail variant
        }
      }
    } catch (e) {
      console.error("wikipedia image lookup failed", e);
    }
    if (!imageUrl) {
      // Guaranteed-working placeholder when Wikipedia has no image for the topic.
      const label = encodeURIComponent(body.topicName.slice(0, 30));
      imageUrl = `https://placehold.co/800x500/4C43D9/ffffff?text=${label}`;
      thumbnailUrl = `https://placehold.co/400x250/4C43D9/ffffff?text=${label}`;
    }

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
    const imgConfig = await queryOne<{ model_name: string; api_key: string; base_url: string | null }>(
      "SELECT model_name, api_key, base_url FROM llm_configs WHERE purpose = 'image_generation' AND active = true"
    );
    if (!imgConfig?.api_key) {
      return NextResponse.json({ error: "Image generation LLM not configured. Go to Admin → Config & API Keys." }, { status: 400 });
    }

    const prompt = `A clean, colorful educational illustration for Grade 7 IB MYP ${body.subjectName}: ${body.topicName}. Clear diagram style suitable for a 12-year-old student. Scientific accuracy. White background. No text overlays.`;

    const base = (imgConfig.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${imgConfig.api_key}`,
      },
      body: JSON.stringify({
        model: imgConfig.model_name,
        prompt,
        n: 1,
        size: "1024x1024",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json(
        { error: `Image generation error: ${err.error?.message ?? `Generation failed. Ensure your account has ${imgConfig.model_name} access.`}` },
        { status: 502 }
      );
    }

    // dall-e-* returns a url; gpt-image-1 returns b64_json — support both.
    const data = await res.json() as { data: { url?: string; b64_json?: string }[] };
    const item = data.data?.[0];
    const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
    if (!imageUrl) return NextResponse.json({ error: "No image returned from the image LLM" }, { status: 502 });

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
