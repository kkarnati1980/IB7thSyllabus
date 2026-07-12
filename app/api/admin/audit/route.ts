import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await query<{ action: string; detail: string; at: string }>(
    "SELECT action, detail, at FROM audit_log ORDER BY at DESC LIMIT 50"
  );
  return NextResponse.json({ log: rows });
}
