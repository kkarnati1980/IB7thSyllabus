import { NextRequest, NextResponse } from "next/server";
import { audit, ensureSeed, execute, hashPassword, nowIso, queryOne, uid } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSeed();
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

  const existing = await queryOne("SELECT id FROM users WHERE email = $1", [email.trim()]);
  if (existing) {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }

  const id = uid("usr");
  const { hash, salt } = hashPassword(password);
  await execute(
    "INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at) VALUES ($1, $2, $3, 'student', $4, $5, true, $6)",
    [id, name.trim(), email.trim(), hash, salt, nowIso()]
  );

  const token = await createSession(id);
  await setSessionCookie(token);
  await audit("REGISTER", `New student registered: ${email}`, id);

  return NextResponse.json({ user: { id, name: name.trim(), email: email.trim(), role: "student" } });
}
