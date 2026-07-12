import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { audit, execute, nowIso, queryOne } from "./db";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type User = {
  id: string;
  name: string;
  email: string;
  role: "student" | "admin" | "grade_teacher" | "subject_teacher" | "guardian";
  active: boolean;
  created_at: string;
  school_id?: string | null;
  grade_level_id?: string | null;
  linked_to_school?: boolean;
  guardian_id?: string | null;
  display_name?: string | null;
};

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_MS);
  await execute(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [token, userId, created.toISOString(), expires.toISOString()]
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await execute("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await queryOne<User & { expires_at: string }>(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
            u.school_id, u.grade_level_id, u.linked_to_school, u.guardian_id, u.display_name,
            s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  if (!row.active) return null;
  const { expires_at: _drop, ...user } = row;
  void _drop;
  return user;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const row = await queryOne<{ user_id: string }>("SELECT user_id FROM sessions WHERE token = $1", [token]);
    await destroySession(token);
    await audit("LOGOUT", "User logged out", row?.user_id ?? null);
  }
  await clearSessionCookie();
}

export async function reapSessions(): Promise<void> {
  await execute("DELETE FROM sessions WHERE expires_at < $1", [nowIso()]);
}

export async function getUserByEmail(email: string): Promise<
  { id: string; pass_hash: string; pass_salt: string; active: boolean; role: string } | undefined
> {
  return queryOne("SELECT id, pass_hash, pass_salt, active, role FROM users WHERE email = $1", [email]);
}
