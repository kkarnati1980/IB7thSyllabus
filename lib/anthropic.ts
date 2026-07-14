import Anthropic from "@anthropic-ai/sdk";

// The API key lives only on the server (never shipped to the browser).
const g = globalThis as unknown as { __anthropic?: Anthropic };

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key."
    );
  }
  return (g.__anthropic ??= new Anthropic());
}

export const MODEL = process.env.JARVIS_MODEL || "claude-opus-4-8";

/**
 * Resolve the admin-configured chat model + API key from llm_configs (purpose
 * 'chat'). Falls back to the environment when the row has no key configured, so
 * chat keeps working on installs that only set ANTHROPIC_API_KEY. The fallback
 * model preserves the historical default rather than the seed placeholder.
 */
export async function getChatModel(): Promise<{ model: string; apiKey: string }> {
  return getLlmConfig("chat", MODEL);
}

/** Same as getChatModel but for the 'moderation' purpose. */
export async function getModerationModel(): Promise<{ model: string; apiKey: string }> {
  return getLlmConfig("moderation", "claude-haiku-4-5-20251001");
}

async function getLlmConfig(
  purpose: string,
  fallbackModel: string
): Promise<{ model: string; apiKey: string }> {
  try {
    const { pool } = await import("@/lib/db");
    const { rows } = await pool.query<{ model_name: string; api_key: string }>(
      "SELECT model_name, api_key FROM llm_configs WHERE purpose = $1 AND active = true LIMIT 1",
      [purpose]
    );
    if (rows[0]?.api_key) return { model: rows[0].model_name, apiKey: rows[0].api_key };
  } catch (e) {
    console.error(`getLlmConfig(${purpose}) failed — using env fallback`, e);
  }
  return { model: fallbackModel, apiKey: process.env.ANTHROPIC_API_KEY ?? "" };
}

/**
 * Anthropic client + model for the given purpose. Builds a client bound to the
 * configured key so the admin's saved key is honoured (getClient() only reads
 * the env var).
 */
export async function getChatClient(): Promise<{ client: Anthropic; model: string }> {
  const { model, apiKey } = await getChatModel();
  if (!apiKey) throw new Error("Chat LLM not configured. Add a key in Admin → Config & API Keys.");
  return { client: new Anthropic({ apiKey }), model };
}

/** Anthropic client + model for the configured 'moderation' purpose. */
export async function getModerationClient(): Promise<{ client: Anthropic; model: string }> {
  const { model, apiKey } = await getModerationModel();
  if (!apiKey) throw new Error("Moderation LLM not configured.");
  return { client: new Anthropic({ apiKey }), model };
}

/**
 * Ask Claude for a JSON payload and parse it defensively. The tutor and the
 * study-tool generators all instruct the model to return raw JSON, but we still
 * tolerate stray code fences / prose the way the original prototype did.
 */
export function parseJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  // Try a whole-string parse first (covers both objects and arrays).
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through */
  }
  // Then try to slice out the outermost object or array.
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
  const lastObj = s.lastIndexOf("}");
  const lastArr = s.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1)) as T;
    } catch {
      /* give up */
    }
  }
  return null;
}

/** Collect the text content of a (non-streaming) Claude message. */
export function messageText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
