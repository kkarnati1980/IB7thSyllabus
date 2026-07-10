import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, db, hashPassword } from "@/lib/db";
import type { PublicUser } from "@/lib/types";

export const runtime = "nodejs";

function listUsers(): PublicUser[] {
  const rows = db
    .prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC")
    .all() as {
    id: string;
    name: string;
    email: string;
    role: "student" | "admin";
    active: number;
    created_at: string;
  }[];
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

// PATCH — edit or toggle a user.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | { id: string; email: string; active: number }
    | undefined;
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: "toggle";
    name?: string;
    email?: string;
    role?: "student" | "admin";
    password?: string;
  };

  if (body.action === "toggle") {
    const next = target.active ? 0 : 1;
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(next, id);
    audit("ADMIN_TOGGLE", `User ${next ? "enabled" : "disabled"}: ${target.email}`, admin.id);
    return NextResponse.json({ users: listUsers() });
  }

  // Field edit.
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email required." }, { status: 400 });
  }
  const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, id);
  if (clash) {
    return NextResponse.json({ error: "Email already used by another account." }, { status: 409 });
  }
  const role = body.role === "admin" ? "admin" : "student";

  if (body.password && body.password.length > 0 && body.password.length < 8) {
    return NextResponse.json({ error: "New password must be 8+ characters." }, { status: 400 });
  }

  if (body.password && body.password.length >= 8) {
    const { hash, salt } = hashPassword(body.password);
    db.prepare(
      "UPDATE users SET name = ?, email = ?, role = ?, pass_hash = ?, pass_salt = ? WHERE id = ?"
    ).run(name, email, role, hash, salt, id);
  } else {
    db.prepare("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?").run(
      name,
      email,
      role,
      id
    );
  }
  audit("ADMIN_EDIT", `Edited user: ${email} (${role})`, admin.id);
  return NextResponse.json({ users: listUsers() });
}

// DELETE — remove a user.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const target = db.prepare("SELECT email FROM users WHERE id = ?").get(id) as
    | { email: string }
    | undefined;
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  audit("ADMIN_DELETE", `Deleted user: ${target.email}`, admin.id);
  return NextResponse.json({ users: listUsers() });
}
