import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, execute, hashPassword, nowIso, query, queryOne, uid } from "@/lib/db";
import type { PublicUser } from "@/lib/types";

export const runtime = "nodejs";

async function listUsers(): Promise<PublicUser[]> {
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    role: "student" | "admin";
    active: boolean;
    created_at: string;
  }>("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    active: !!r.active,
    createdAt: r.created_at,
  }));
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, email, password, role } = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
    role?: "student" | "admin";
  };
  if (!name || !email || !password) {
    return NextResponse.json({ error: "All fields required." }, { status: 400 });
  }
  const existing = await queryOne("SELECT id FROM users WHERE email = $1", [email.trim()]);
  if (existing) {
    return NextResponse.json({ error: "Email already exists." }, { status: 409 });
  }

  const id = uid("usr");
  const { hash, salt } = hashPassword(password);
  await execute(
    "INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at) VALUES ($1, $2, $3, $4, $5, $6, true, $7)",
    [id, name.trim(), email.trim(), role === "admin" ? "admin" : "student", hash, salt, nowIso()]
  );
  await audit("ADMIN_CREATE", `Created user: ${email} (${role || "student"})`, admin.id);

  return NextResponse.json({ users: await listUsers() });
}
