#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Jarvis IB7 — Full automated migration + Vercel deploy
# Prerequisites:
#   export SUPABASE_DB_PASSWORD="..."
#   export VERCEL_TOKEN="..."
# ---------------------------------------------------------------------------

REPO="/Users/kishore/Codex_Development/IB7thSyllabus"
RAG_DIR="$REPO/Advaith_7th_Grade_RAG"
PROJECT_ID="gvzjghdlqsqalkvqianj"
SUPABASE_HOST="aws-0-ap-south-1.pooler.supabase.com"
SUPABASE_PORT="6543"
SUPABASE_USER="postgres.${PROJECT_ID}"
SUPABASE_DB="postgres"

# ── Validate prerequisites ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Jarvis IB7 — Automated Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "ERROR: SUPABASE_DB_PASSWORD is not set."
  echo "  export SUPABASE_DB_PASSWORD='your_password'"
  exit 1
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "ERROR: VERCEL_TOKEN is not set."
  echo "  export VERCEL_TOKEN='your_token'"
  exit 1
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set."
  echo "  export ANTHROPIC_API_KEY='your_key'"
  exit 1
fi

DATABASE_URL="postgresql://${SUPABASE_USER}:${SUPABASE_DB_PASSWORD}@${SUPABASE_HOST}:${SUPABASE_PORT}/${SUPABASE_DB}"

cd "$REPO"

# ── Step 1: Replace lib/db.ts ────────────────────────────────────────────────
echo "[1/8] Writing lib/db.ts (Postgres)..."
cat > lib/db.ts << 'DBTS'
import { randomBytes, scryptSync } from "node:crypto";
import { Pool } from "pg";

const g = globalThis as unknown as { __jarvisPool?: Pool };

function connect(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

export const pool: Pool = g.__jarvisPool ?? (g.__jarvisPool = connect());

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await pool.query(sql, params);
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64).toString("hex");
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function uid(prefix = "u"): string {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function audit(action: string, detail: string, userId: string | null = null): Promise<void> {
  await execute(
    "INSERT INTO audit_log (id, action, detail, user_id, at) VALUES ($1, $2, $3, $4, $5)",
    [uid("log"), action, detail, userId, nowIso()]
  );
}

export async function ensureSeed(): Promise<void> {
  const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!admin) {
    const { hash, salt } = hashPassword("password");
    await execute(
      `INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at)
       VALUES ($1, $2, $3, 'admin', $4, $5, true, $6) ON CONFLICT DO NOTHING`,
      ["admin_1", "Administrator", "admin", hash, salt, nowIso()]
    );
    await audit("SEED", "Default admin account created (admin / password)", "admin_1");
  }
}

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

export async function ingestFile(name: string, text: string): Promise<{ id: string; subject: string; count: number }> {
  const titleMatch = text.match(/^#\s*(.+)/m);
  const subject = titleMatch ? titleMatch[1].split(":")[0].trim() : name.replace(/\.(md|markdown|txt)$/i, "");
  const fileId = uid("file");
  const createdAt = nowIso();
  const parts = text.split(/\n(?=#{1,3}\s)/);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query<{ id: string }>("SELECT id FROM syllabus_files WHERE name = $1", [name]);
    if (prior.rows[0]) {
      await client.query("DELETE FROM syllabus_files WHERE id = $1", [prior.rows[0].id]);
    }
    await client.query(
      "INSERT INTO syllabus_files (id, name, subject, created_at) VALUES ($1, $2, $3, $4)",
      [fileId, name, subject, createdAt]
    );
    let count = 0;
    for (const p of parts) {
      const hm = p.match(/^#{1,3}\s*(.+)/);
      const heading = hm ? hm[1].trim() : "Intro";
      const body = p.replace(/^#{1,3}\s*.+\n?/, "").trim();
      if (!body) continue;
      const tf: Record<string, number> = {};
      for (const w of tokenize(p)) tf[w] = (tf[w] || 0) + 1;
      await client.query(
        "INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf) VALUES ($1, $2, $3, $4, $5, $6)",
        [uid("chunk"), fileId, name, heading, body, JSON.stringify(tf)]
      );
      count++;
    }
    await client.query("COMMIT");
    return { id: fileId, subject, count };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const SUBJECT_PALETTE: [string, string, string][] = [
  ["#4C43D9", "#ECEBFB", "🔬"],
  ["#2E9E6B", "#E4F3EC", "📐"],
  ["#E8823A", "#FBE9DC", "🌍"],
  ["#C0392B", "#FDECEA", "📖"],
  ["#7A5AC2", "#EFE9FB", "🎨"],
];

export type SubjectRow = {
  id: string;
  name: string;
  color: string;
  soft: string;
  icon: string;
  topics: { id: string; name: string }[];
};

export async function getSubjects(): Promise<SubjectRow[]> {
  const files = await query<{ id: string; name: string; subject: string }>(
    "SELECT id, name, subject FROM syllabus_files ORDER BY created_at ASC"
  );
  const results: SubjectRow[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const headings = await query<{ heading: string }>(
      "SELECT heading FROM syllabus_chunks WHERE file_id = $1 AND heading != 'Intro'",
      [f.id]
    );
    const seen = new Set<string>();
    const topics: { id: string; name: string }[] = [];
    headings.forEach((h) => {
      if (seen.has(h.heading)) return;
      seen.add(h.heading);
      topics.push({ id: `${f.id}_t${topics.length}`, name: h.heading });
    });
    const [color, soft, icon] = SUBJECT_PALETTE[i % SUBJECT_PALETTE.length];
    results.push({ id: f.id, name: f.subject, color, soft, icon, topics });
  }
  return results;
}

export async function retrieve(query_str: string, k = 4): Promise<{ file: string; heading: string; text: string }[]> {
  const qt = tokenize(query_str);
  if (!qt.length) return [];
  const chunks = await query<{ file_name: string; heading: string; body: string; tf: string }>(
    "SELECT file_name, heading, body, tf FROM syllabus_chunks"
  );
  if (!chunks.length) return [];
  const N = chunks.length;
  const df: Record<string, number> = {};
  const parsed = chunks.map((c) => {
    const tf = (typeof c.tf === "string" ? JSON.parse(c.tf) : c.tf) as Record<string, number>;
    for (const w of Object.keys(tf)) df[w] = (df[w] || 0) + 1;
    return { ...c, tfMap: tf };
  });
  return parsed
    .map((c) => {
      let s = 0;
      for (const w of qt) {
        if (c.tfMap[w]) s += c.tfMap[w] * Math.log(1 + N / (df[w] || 1));
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => ({ file: x.c.file_name, heading: x.c.heading, text: x.c.body }));
}
DBTS
echo "    ✓ lib/db.ts written"

# ── Step 2: Replace lib/auth.ts ──────────────────────────────────────────────
echo "[2/8] Writing lib/auth.ts..."
cat > lib/auth.ts << 'AUTHTS'
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { audit, execute, nowIso, queryOne } from "./db";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type User = {
  id: string;
  name: string;
  email: string;
  role: "student" | "admin";
  active: boolean;
  created_at: string;
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
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, s.expires_at
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
AUTHTS
echo "    ✓ lib/auth.ts written"

# ── Step 3: Replace lib/progress.ts ─────────────────────────────────────────
echo "[3/8] Writing lib/progress.ts..."
cat > lib/progress.ts << 'PROGRESSTS'
import { execute, query, queryOne } from "./db";
import type { ProgressEntry } from "./types";

export async function getProgress(userId: string): Promise<ProgressEntry[]> {
  const rows = await query<{
    topic_id: string; topic_name: string; subject: string; icon: string;
    color: string; mastery: number; misconceptions: string; last_seen: number;
  }>("SELECT * FROM progress WHERE user_id = $1", [userId]);
  return rows.map((r) => ({
    topicId: r.topic_id,
    topicName: r.topic_name,
    subject: r.subject,
    icon: r.icon,
    color: r.color,
    mastery: r.mastery,
    misconceptions: typeof r.misconceptions === "string"
      ? JSON.parse(r.misconceptions || "[]")
      : (r.misconceptions as unknown as string[]) || [],
    lastSeen: Number(r.last_seen),
  }));
}

export async function updateProgress(
  userId: string,
  entry: {
    topicId: string; topicName: string; subject: string; icon: string;
    color: string; masteryDelta: number; misconceptions?: string[];
  }
): Promise<ProgressEntry> {
  const prior = await queryOne<{ mastery: number; misconceptions: string }>(
    "SELECT mastery, misconceptions FROM progress WHERE user_id = $1 AND topic_id = $2",
    [userId, entry.topicId]
  );
  const priorMastery = prior?.mastery ?? 0;
  const mastery = Math.max(0, Math.min(100, priorMastery + (entry.masteryDelta || 0)));
  const misc: string[] = prior
    ? typeof prior.misconceptions === "string"
      ? JSON.parse(prior.misconceptions || "[]")
      : (prior.misconceptions as unknown as string[]) || []
    : [];
  for (const m of entry.misconceptions || []) {
    if (m && !misc.includes(m)) misc.push(m);
  }
  const lastSeen = Date.now();
  await execute(
    `INSERT INTO progress (user_id, topic_id, topic_name, subject, icon, color, mastery, misconceptions, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, topic_id) DO UPDATE SET
       mastery = $7, misconceptions = $8, last_seen = $9,
       topic_name = $3, subject = $4, icon = $5, color = $6`,
    [userId, entry.topicId, entry.topicName, entry.subject, entry.icon, entry.color,
     mastery, JSON.stringify(misc), lastSeen]
  );
  return {
    topicId: entry.topicId, topicName: entry.topicName, subject: entry.subject,
    icon: entry.icon, color: entry.color, mastery, misconceptions: misc, lastSeen,
  };
}

export async function trackerSummary(userId: string): Promise<string> {
  const rows = await getProgress(userId);
  if (!rows.length) return "New learner, no history yet.";
  return rows.map((r) => `${r.topicName}: ${r.mastery}% mastery`).join("; ");
}
PROGRESSTS
echo "    ✓ lib/progress.ts written"

# ── Step 4: Write vercel.json ────────────────────────────────────────────────
echo "[4/8] Writing vercel.json..."
cat > vercel.json << 'VERCELJSON'
{
  "framework": "nextjs",
  "buildCommand": "next build",
  "devCommand": "next dev",
  "installCommand": "npm install"
}
VERCELJSON
echo "    ✓ vercel.json written"

# ── Step 5: Swap npm dependencies ────────────────────────────────────────────
echo "[5/8] Swapping dependencies (better-sqlite3 → pg)..."
npm uninstall better-sqlite3 @types/better-sqlite3 --save 2>/dev/null || true
npm install pg --save
npm install @types/pg dotenv --save-dev
echo "    ✓ Dependencies updated"

# ── Step 6: Write .env.local ─────────────────────────────────────────────────
echo "[6/8] Writing .env.local..."
cat > .env.local << ENVLOCAL
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
DATABASE_URL=${DATABASE_URL}
ENVLOCAL
echo "    ✓ .env.local written"

# ── Step 7: Seed Supabase with RAG data ──────────────────────────────────────
echo "[7/8] Seeding Supabase with RAG data..."
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const pool = new Pool({
  connectionString: '${DATABASE_URL}',
  ssl: { rejectUnauthorized: false }
});

const RAG_DIR = '${RAG_DIR}';

function uid(prefix) {
  return prefix + '_' + randomBytes(9).toString('hex');
}
function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM syllabus_chunks');
    await client.query('DELETE FROM syllabus_files');
    console.log('    Cleared existing syllabus data');

    const files = fs.readdirSync(RAG_DIR).filter(f => f.endsWith('.md'));
    for (const name of files) {
      const text = fs.readFileSync(path.join(RAG_DIR, name), 'utf8');
      const titleMatch = text.match(/^#\s*(.+)/m);
      const subject = titleMatch ? titleMatch[1].split(':')[0].trim() : name.replace(/\.md$/i, '');
      const fileId = uid('file');
      const now = new Date().toISOString();
      const parts = text.split(/\n(?=#{1,3}\s)/);

      await client.query('BEGIN');
      await client.query(
        'INSERT INTO syllabus_files (id, name, subject, created_at) VALUES (\$1, \$2, \$3, \$4)',
        [fileId, name, subject, now]
      );
      let count = 0;
      for (const p of parts) {
        const hm = p.match(/^#{1,3}\s*(.+)/);
        const heading = hm ? hm[1].trim() : 'Intro';
        const body = p.replace(/^#{1,3}\s*.+\n?/, '').trim();
        if (!body) continue;
        const tf = {};
        for (const w of tokenize(p)) tf[w] = (tf[w] || 0) + 1;
        await client.query(
          'INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf) VALUES (\$1, \$2, \$3, \$4, \$5, \$6)',
          [uid('chunk'), fileId, name, heading, body, JSON.stringify(tf)]
        );
        count++;
      }
      await client.query('COMMIT');
      console.log('    ' + name + ' -> ' + subject + ' (' + count + ' chunks)');
    }
    const { rows } = await client.query('SELECT COUNT(*) AS n FROM syllabus_chunks');
    console.log('    Total chunks: ' + rows[0].n);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(e => { console.error(e); process.exit(1); });
"
echo "    ✓ Supabase seeded"

# ── Step 8: Deploy to Vercel ─────────────────────────────────────────────────
echo "[8/8] Deploying to Vercel..."

# Install Vercel CLI if not present
if ! command -v vercel &> /dev/null; then
  echo "    Installing Vercel CLI..."
  npm install -g vercel
fi

# Deploy with env vars
vercel --prod \
  --token "$VERCEL_TOKEN" \
  --yes \
  --env DATABASE_URL="$DATABASE_URL" \
  --env ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✅ Done! Jarvis IB7 is live on Vercel."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
