import { NextRequest, NextResponse } from "next/server";
import { audit, ensureSeed, queryOne, verifyPassword } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSeed();
  const { email, password, admin } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    admin?: boolean;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "Please enter credentials." }, { status: 400 });
  }

  const user = await queryOne<{
    id: string;
    name: string;
    email: string;
    role: string;
    pass_hash: string;
    pass_salt: string;
    active: boolean;
  }>("SELECT * FROM users WHERE email = $1", [email.trim()]);

  if (!user || !user.active || !verifyPassword(password, user.pass_hash, user.pass_salt)) {
    await audit("LOGIN_FAIL", `Failed login for ${email}`, null);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  if (admin && user.role !== "admin") {
    await audit("LOGIN_FAIL", `Non-admin attempted admin route: ${email}`, null);
    return NextResponse.json({ error: "Admin access only on this route." }, { status: 403 });
  }

  const token = await createSession(user.id);
  await setSessionCookie(token);
  await audit("LOGIN", `User logged in: ${user.email}`, user.id);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
