import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    text?: string;
    voiceId?: string;
  };

  if (!body.text) return NextResponse.json({ error: "text required" }, { status: 400 });

  // Resolve the admin-configured voice_tts provider/model/key.
  const voiceConfig = await queryOne<{ provider: string; model_name: string; api_key: string }>(
    "SELECT provider, model_name, api_key FROM llm_configs WHERE purpose = 'voice_tts' AND active = true"
  );
  if (!voiceConfig?.api_key) {
    return NextResponse.json({ error: "Voice TTS not configured" }, { status: 400 });
  }

  // Use user's preferred voice or default
  const voiceId = body.voiceId || "EXAVITQu4vr4xnSDxMaL"; // Sarah (warm, clear)

  const clean = body.text.replace(/[*#_`>]/g, "").slice(0, 500); // cap at 500 chars

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": voiceConfig.api_key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: clean,
        model_id: voiceConfig.model_name,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("ElevenLabs error:", err);
    return NextResponse.json({ error: "TTS failed" }, { status: 502 });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
