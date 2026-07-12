import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");

  if (key) {
    const row = await queryOne<{ value: string }>(
      "SELECT value FROM app_config WHERE key = $1", [key]
    );
    return NextResponse.json({ value: row?.value ?? null });
  }

  // Admin can get all config
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await query<{ key: string; value: string; updated_at: string }>(
    "SELECT key, value, updated_at FROM app_config ORDER BY key ASC"
  );
  return NextResponse.json({ config: rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { key?: string; value?: string };
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }

  await execute(
    `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [body.key, body.value, nowIso()]
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await execute("DELETE FROM app_config WHERE key = $1", [key]);
  return NextResponse.json({ ok: true });
}
