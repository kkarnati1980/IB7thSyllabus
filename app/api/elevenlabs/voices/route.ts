import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyRow = await queryOne<{ value: string }>(
    "SELECT value FROM app_config WHERE key = 'elevenlabs_api_key'"
  );
  if (!keyRow?.value) {
    return NextResponse.json({ error: "ElevenLabs API key not configured", voices: [] });
  }

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": keyRow.value },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Could not fetch voices", voices: [] });
  }

  const data = await res.json() as {
    voices: {
      voice_id: string;
      name: string;
      category: string;
      labels?: Record<string, string>;
      preview_url?: string;
    }[];
  };

  const voices = data.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    gender: v.labels?.gender ?? "unknown",
    accent: v.labels?.accent ?? "",
    previewUrl: v.preview_url ?? "",
  }));

  return NextResponse.json({ voices });
}
