import Database from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// SQLite connection (single shared instance across the Next.js server process)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.JARVIS_DB_PATH || path.join(DATA_DIR, "jarvis.db");

// Reuse the connection across hot-reloads in dev.
const g = globalThis as unknown as { __jarvisDb?: Database.Database };

function connect(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export const db: Database.Database = g.__jarvisDb ?? (g.__jarvisDb = connect());

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      role        TEXT NOT NULL DEFAULT 'student',
      pass_hash   TEXT NOT NULL,
      pass_salt   TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      action      TEXT NOT NULL,
      detail      TEXT NOT NULL,
      user_id     TEXT,
      at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS syllabus_files (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      subject     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS syllabus_chunks (
      id          TEXT PRIMARY KEY,
      file_id     TEXT NOT NULL REFERENCES syllabus_files(id) ON DELETE CASCADE,
      file_name   TEXT NOT NULL,
      heading     TEXT NOT NULL,
      body        TEXT NOT NULL,
      tf          TEXT NOT NULL           -- JSON: term-frequency map
    );

    CREATE TABLE IF NOT EXISTS progress (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic_id    TEXT NOT NULL,
      topic_name  TEXT NOT NULL,
      subject     TEXT NOT NULL,
      icon        TEXT NOT NULL,
      color       TEXT NOT NULL,
      mastery     INTEGER NOT NULL DEFAULT 0,
      misconceptions TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
      last_seen   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, topic_id)
    );
  `);
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt with per-user salt)
// ---------------------------------------------------------------------------
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64).toString("hex");
  // constant-time-ish comparison
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

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------
export function audit(action: string, detail: string, userId: string | null = null): void {
  db.prepare(
    "INSERT INTO audit_log (id, action, detail, user_id, at) VALUES (?, ?, ?, ?, ?)"
  ).run(uid("log"), action, detail, userId, nowIso());
}

// ---------------------------------------------------------------------------
// Seed default admin + sample syllabus on first run
// ---------------------------------------------------------------------------
export function ensureSeed(): void {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    const { hash, salt } = hashPassword("password");
    db.prepare(
      "INSERT INTO users (id, name, email, role, pass_hash, pass_salt, active, created_at) VALUES (?, ?, ?, 'admin', ?, ?, 1, ?)"
    ).run("admin_1", "Administrator", "admin", hash, salt, nowIso());
    audit("SEED", "Default admin account created (admin / password)", "admin_1");
  }

  const anyFile = db.prepare("SELECT id FROM syllabus_files LIMIT 1").get();
  if (!anyFile) {
    for (const f of SAMPLE_SYLLABUS) ingestFile(f.name, f.text);
    audit("SEED", "Sample IB MYP syllabus files indexed", null);
  }
}

// ---------------------------------------------------------------------------
// RAG ingestion — chunk markdown by heading, store TF maps
// ---------------------------------------------------------------------------
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

export function ingestFile(name: string, text: string): { id: string; subject: string; count: number } {
  const titleMatch = text.match(/^#\s*(.+)/m);
  const subject = titleMatch ? titleMatch[1].split(":")[0].trim() : name.replace(/\.(md|markdown|txt)$/i, "");
  const fileId = uid("file");
  const createdAt = nowIso();

  const parts = text.split(/\n(?=#{1,3}\s)/);
  const insertChunk = db.prepare(
    "INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    // Replace any prior file with the same name so re-uploads overwrite cleanly.
    const prior = db.prepare("SELECT id FROM syllabus_files WHERE name = ?").get(name) as
      | { id: string }
      | undefined;
    if (prior) db.prepare("DELETE FROM syllabus_files WHERE id = ?").run(prior.id);

    db.prepare(
      "INSERT INTO syllabus_files (id, name, subject, created_at) VALUES (?, ?, ?, ?)"
    ).run(fileId, name, subject, createdAt);

    let count = 0;
    for (const p of parts) {
      const hm = p.match(/^#{1,3}\s*(.+)/);
      const heading = hm ? hm[1].trim() : "Intro";
      const body = p.replace(/^#{1,3}\s*.+\n?/, "").trim();
      if (!body) continue;
      const tf: Record<string, number> = {};
      for (const w of tokenize(p)) tf[w] = (tf[w] || 0) + 1;
      insertChunk.run(uid("chunk"), fileId, name, heading, body, JSON.stringify(tf));
      count++;
    }
    return count;
  });

  const count = tx();
  return { id: fileId, subject, count };
}

// ---------------------------------------------------------------------------
// Subjects & topics derived from the indexed syllabus (shared curriculum)
// ---------------------------------------------------------------------------
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

export function getSubjects(): SubjectRow[] {
  const files = db
    .prepare("SELECT id, name, subject FROM syllabus_files ORDER BY created_at ASC")
    .all() as { id: string; name: string; subject: string }[];

  return files.map((f, i) => {
    const headings = db
      .prepare("SELECT heading FROM syllabus_chunks WHERE file_id = ? AND heading != 'Intro'")
      .all(f.id) as { heading: string }[];
    // Deduplicate headings while preserving order.
    const seen = new Set<string>();
    const topics: { id: string; name: string }[] = [];
    headings.forEach((h) => {
      if (seen.has(h.heading)) return;
      seen.add(h.heading);
      topics.push({ id: `${f.id}_t${topics.length}`, name: h.heading });
    });
    const [color, soft, icon] = SUBJECT_PALETTE[i % SUBJECT_PALETTE.length];
    return { id: f.id, name: f.subject, color, soft, icon, topics };
  });
}

// ---------------------------------------------------------------------------
// TF-IDF retrieval over stored chunks (server-side RAG)
// ---------------------------------------------------------------------------
export function retrieve(query: string, k = 4): { file: string; heading: string; text: string }[] {
  const qt = tokenize(query);
  if (!qt.length) return [];
  const chunks = db
    .prepare("SELECT file_name, heading, body, tf FROM syllabus_chunks")
    .all() as { file_name: string; heading: string; body: string; tf: string }[];
  if (!chunks.length) return [];

  const N = chunks.length;
  const df: Record<string, number> = {};
  const parsed = chunks.map((c) => {
    const tf = JSON.parse(c.tf) as Record<string, number>;
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

// ---------------------------------------------------------------------------
// Sample syllabus (baked in so the app works out of the box)
// ---------------------------------------------------------------------------
export const SAMPLE_SYLLABUS: { name: string; text: string }[] = [
  {
    name: "Sciences — Cells & Systems.md",
    text: `# Sciences: Cells
## Cell Theory
All living things are made of cells. Cells are the basic unit of life and come from pre-existing cells.
## Cell Organelles
The nucleus controls the cell. Mitochondria release energy through respiration. Chloroplasts (in plants) capture light for photosynthesis. The cell membrane controls what enters and leaves.
## Diffusion & Osmosis
Diffusion is the movement of particles from high to low concentration. Osmosis is the diffusion of water across a membrane.
## Body Systems
The circulatory, respiratory and digestive systems work together to keep an organism alive.`,
  },
  {
    name: "Mathematics — Ratio & Proportion.md",
    text: `# Mathematics: Ratio and Proportion
## Ratios
A ratio compares two quantities, e.g. 2:3. Ratios can be simplified like fractions.
## Proportion
Two ratios are in proportion when they are equal. Direct proportion means as one increases the other increases at the same rate.
## Scaling & Maps
Scale drawings and map scales use ratio. Unit rates express a quantity per single unit.
## Percentages
Percentages are ratios out of 100 and are used in discounts, interest and data.`,
  },
  {
    name: "Individuals & Societies — Trade.md",
    text: `# Individuals and Societies: Trade and Exchange
## Why Trade Happens
People and countries trade to get resources they cannot produce themselves. Specialisation increases efficiency.
## Supply and Demand
Prices are shaped by how much of something is available and how much people want it.
## Global Trade
Trade connects distant regions, spreading goods, ideas and culture but also creating dependence.`,
  },
];
