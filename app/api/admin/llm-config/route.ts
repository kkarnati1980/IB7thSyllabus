import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";
import { getChatClient } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

const PURPOSES = ["chat", "image_generation", "voice_tts", "moderation"] as const;

function mask(key: string): string {
  if (!key) return "";
  const last4 = key.slice(-4);
  return "••••••••" + last4;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await query<{
    purpose: string; provider: string; model_name: string; api_key: string;
    base_url: string | null; active: boolean; updated_at: string;
  }>("SELECT purpose, provider, model_name, api_key, base_url, active, updated_at FROM llm_configs ORDER BY purpose");
  const configs = rows.map((r) => ({
    purpose: r.purpose,
    provider: r.provider,
    modelName: r.model_name,
    apiKeyMasked: mask(r.api_key),
    hasKey: !!r.api_key,
    baseUrl: r.base_url ?? undefined,
    active: r.active,
    updatedAt: r.updated_at,
  }));
  return NextResponse.json({ configs });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; purpose?: string; provider?: string; modelName?: string; apiKey?: string; baseUrl?: string;
  };

  // Test-connection support for the admin UI.
  if (body.action === "test") {
    if (!body.purpose || !PURPOSES.includes(body.purpose as typeof PURPOSES[number])) {
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    }
    return testConnection(body.purpose);
  }

  const { purpose, provider, modelName } = body;
  if (!purpose || !PURPOSES.includes(purpose as typeof PURPOSES[number])) {
    return NextResponse.json({ error: "purpose must be one of " + PURPOSES.join(", ") }, { status: 400 });
  }
  if (!provider || !modelName) {
    return NextResponse.json({ error: "provider and modelName required" }, { status: 400 });
  }
  const apiKey = (body.apiKey ?? "").trim();
  const baseUrl = (body.baseUrl ?? "").trim() || null;
  const now = nowIso();
  // Preserve the stored key when the admin submits without changing it (empty apiKey).
  await execute(
    `INSERT INTO llm_configs (id, purpose, provider, model_name, api_key, base_url, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (purpose) DO UPDATE SET
       provider = EXCLUDED.provider,
       model_name = EXCLUDED.model_name,
       base_url = EXCLUDED.base_url,
       api_key = CASE WHEN $5 <> '' THEN $5 ELSE llm_configs.api_key END,
       active = true,
       updated_at = $7`,
    [uid("llm"), purpose, provider, modelName, apiKey, baseUrl, now]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const purpose = new URL(req.url).searchParams.get("purpose");
  if (!purpose) return NextResponse.json({ error: "purpose required" }, { status: 400 });
  await execute("DELETE FROM llm_configs WHERE purpose = $1", [purpose]);
  return NextResponse.json({ ok: true });
}

async function testConnection(purpose: string): Promise<NextResponse> {
  const cfg = await queryOne<{ provider: string; model_name: string; api_key: string }>(
    "SELECT provider, model_name, api_key FROM llm_configs WHERE purpose = $1 AND active = true",
    [purpose]
  );
  if (!cfg?.api_key) return NextResponse.json({ ok: false, message: "No API key saved for this purpose." });

  try {
    if (purpose === "chat" || purpose === "moderation") {
      const { client, model } = await getChatClient();
      const msg = await client.messages.create({ model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] });
      const ok = Array.isArray(msg.content) && msg.content.length > 0;
      return NextResponse.json({ ok, message: ok ? `Connected ✓ — ${model} responded` : "No response from model" });
    }
    if (purpose === "voice_tts") {
      if (cfg.provider === "elevenlabs") {
        const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": cfg.api_key } });
        if (!res.ok) return NextResponse.json({ ok: false, message: "ElevenLabs rejected the key." });
        const data = (await res.json()) as { voices?: unknown[] };
        return NextResponse.json({ ok: true, message: `Connected ✓ — ${data.voices?.length ?? 0} voices available` });
      }
      return NextResponse.json({ ok: true, message: `Key saved — TTS will use ${cfg.model_name}` });
    }
    // image_generation
    return NextResponse.json({ ok: true, message: `Key saved — image generation will use ${cfg.model_name}` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Test failed: ${(e as Error).message}` });
  }
}
