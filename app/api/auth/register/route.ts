import { NextRequest, NextResponse } from "next/server";
import { audit, db, ensureSeed, hashPassword, nowIso, uid } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  ensureSeed();
  const { name, email, password } = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    return NextResponse.json({ error: "All fields required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be 8+ characters." }, { status: 400 });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim());
  if (existing) {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }

  const id = uid("usr");
  const { hash, salt } = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at) VALUES (?, ?, ?, 'student', ?, ?, 1, ?)"
  ).run(id, name.trim(), email.trim(), hash, salt, nowIso());

  const token = createSession(id);
  await setSessionCookie(token);
  audit("REGISTER", `New student registered: ${email}`, id);

  return NextResponse.json({ user: { id, name: name.trim(), email: email.trim(), role: "student" } });
}
