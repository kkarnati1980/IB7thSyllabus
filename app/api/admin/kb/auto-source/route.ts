import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";
import { getChatClient, messageText, parseJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_HEADINGS = 20; // ponytail: cap per run so the request can't run away; re-run to continue.

// POST { fileId, options: { images, videos, aiImages } }
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    fileId?: string;
    options?: { images?: boolean; videos?: boolean; aiImages?: boolean };
  };
  if (!body.fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });
  const opts = body.options ?? {};

  const file = await queryOne<{ subject: string; grade_level_id: string }>(
    "SELECT subject, grade_level_id FROM syllabus_files WHERE id = $1",
    [body.fileId]
  );
  if (!file) return NextResponse.json({ error: "Unknown file" }, { status: 404 });
  const grade = await queryOne<{ grade: string }>("SELECT grade FROM grade_levels WHERE id = $1", [file.grade_level_id]);
  const gradeNum = grade?.grade ?? "7";

  const rows = await query<{ heading: string }>(
    "SELECT DISTINCT heading FROM syllabus_chunks WHERE file_id = $1 AND heading <> 'Intro'",
    [body.fileId]
  );
  const headings = rows.map((r) => r.heading).slice(0, MAX_HEADINGS);

  let imagesFound = 0;
  let videosFound = 0;
  const truncated = rows.length > MAX_HEADINGS;

  for (const heading of headings) {
    if (opts.images) {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
          heading
        )}&prop=pageimages&format=json&pithumbsize=600&origin=*`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as { query?: { pages?: Record<string, { thumbnail?: { source?: string } }> } };
          const pages = data.query?.pages ?? {};
          const thumb = Object.values(pages)[0]?.thumbnail?.source;
          if (thumb) {
            await execute(
              "INSERT INTO topic_images (id, topic_name, subject_name, image_url, thumbnail_url, alt_text, source, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'web','pending',$7)",
              [uid("img"), heading, file.subject, thumb, thumb, `${heading} — Wikipedia image`, nowIso()]
            );
            imagesFound++;
          }
        }
      } catch (e) {
        console.error("auto-source image failed for", heading, e);
      }
    }

    if (opts.videos) {
      try {
        const { client, model } = await getChatClient();
        const msg = await client.messages.create({
          model,
          max_tokens: 500,
          system: "You suggest educational YouTube videos. Return ONLY JSON, no preamble.",
          messages: [
            {
              role: "user",
              content:
                `List 3 specific YouTube video titles and their channels that best explain ` +
                `"${heading}" for IB MYP Grade ${gradeNum} students. ` +
                `Return JSON: [{"title": string, "channel": string, "search_query": string}]`,
            },
          ],
        });
        const suggestions = parseJson<{ title: string; channel?: string; search_query?: string }[]>(messageText(msg));
        if (Array.isArray(suggestions)) {
          for (const s of suggestions.slice(0, 3)) {
            if (!s?.title) continue;
            await execute(
              "INSERT INTO video_suggestions (id, file_id, heading, title, channel, search_query, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
              [uid("vsug"), body.fileId, heading, s.title, s.channel ?? null, s.search_query ?? null, nowIso()]
            );
            videosFound++;
          }
        }
      } catch (e) {
        console.error("auto-source video failed for", heading, e);
      }
    }
  }

  return NextResponse.json({
    imagesFound,
    videosFound,
    headingsProcessed: headings.length,
    truncated,
    aiImages: opts.aiImages ? "AI image generation is available per-topic in the Topic Images tab." : undefined,
  });
}
