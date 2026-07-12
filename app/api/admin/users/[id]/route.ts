import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, execute, hashPassword, query, queryOne } from "@/lib/db";
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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const target = await queryOne<{ id: string; email: string; active: boolean }>(
    "SELECT id, email, active FROM users WHERE id = $1", [id]
  );
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "toggle";
    name?: string;
    email?: string;
    role?: "student" | "admin";
    password?: string;
  };

  if (body.action === "toggle") {
    const next = !target.active;
    await execute("UPDATE users SET active = $1 WHERE id = $2", [next, id]);
    await audit("ADMIN_TOGGLE", `User ${next ? "enabled" : "disabled"}: ${target.email}`, admin.id);
    return NextResponse.json({ users: await listUsers() });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email required." }, { status: 400 });
  }
  const clash = await queryOne("SELECT id FROM users WHERE email = $1 AND id != $2", [email, id]);
  if (clash) {
    return NextResponse.json({ error: "Email already used by another account." }, { status: 409 });
  }
  const role = body.role === "admin" ? "admin" : "student";

  if (body.password && body.password.length > 0 && body.password.length < 8) {
    return NextResponse.json({ error: "New password must be 8+ characters." }, { status: 400 });
  }

  if (body.password && body.password.length >= 8) {
    const { hash, salt } = hashPassword(body.password);
    await execute(
      "UPDATE users SET name = $1, email = $2, role = $3, pass_hash = $4, pass_salt = $5 WHERE id = $6",
      [name, email, role, hash, salt, id]
    );
  } else {
    await execute("UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4", [name, email, role, id]);
  }
  await audit("ADMIN_EDIT", `Edited user: ${email} (${role})`, admin.id);
  return NextResponse.json({ users: await listUsers() });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const target = await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1", [id]);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await execute("DELETE FROM users WHERE id = $1", [id]);
  await audit("ADMIN_DELETE", `Deleted user: ${target.email}`, admin.id);
  return NextResponse.json({ users: await listUsers() });
}
