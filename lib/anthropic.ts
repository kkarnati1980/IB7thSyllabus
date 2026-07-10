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
