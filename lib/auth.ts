import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { audit, db, nowIso } from "./db";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export type User = {
  id: string;
  name: string;
  email: string;
  role: "student" | "admin";
  active: number;
  created_at: string;
};

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_MS);
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, created.toISOString(), expires.toISOString());
  return token;
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Resolve the currently authenticated user from the session cookie, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token) as (User & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
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
    const row = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token) as
      | { user_id: string }
      | undefined;
    destroySession(token);
    audit("LOGOUT", "User logged out", row?.user_id ?? null);
  }
  await clearSessionCookie();
}

/** Reap expired sessions (best-effort housekeeping). */
export function reapSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
}
