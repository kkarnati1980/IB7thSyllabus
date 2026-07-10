import { NextRequest, NextResponse } from "next/server";
import { audit, db, ensureSeed, verifyPassword } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  ensureSeed();
  const { email, password, admin } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    admin?: boolean;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "Please enter credentials." }, { status: 400 });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim()) as
    | {
        id: string;
        name: string;
        email: string;
        role: string;
        pass_hash: string;
        pass_salt: string;
        active: number;
      }
    | undefined;

  if (!user || !user.active || !verifyPassword(password, user.pass_hash, user.pass_salt)) {
    audit("LOGIN_FAIL", `Failed login for ${email}`, "anon");
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  if (admin && user.role !== "admin") {
    audit("LOGIN_FAIL", `Non-admin attempted admin route: ${email}`, "anon");
    return NextResponse.json({ error: "Admin access only on this route." }, { status: 403 });
  }

  const token = createSession(user.id);
  await setSessionCookie(token);
  audit("LOGIN", `User logged in: ${user.email}`, user.id);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
