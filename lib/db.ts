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

export async function ingestFile(
  name: string,
  text: string,
  gradeLevelId = "grade_7_iish"
): Promise<{ id: string; subject: string; count: number }> {
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
      "INSERT INTO syllabus_files (id, name, subject, grade_level_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [fileId, name, subject, gradeLevelId, createdAt]
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
        "INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf, grade_level_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [uid("chunk"), fileId, name, heading, body, JSON.stringify(tf), gradeLevelId]
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
  const files = await query<{ id: string; name: string; subject: string; short_name: string }>(
    "SELECT id, name, subject, COALESCE(short_name, subject) AS short_name FROM syllabus_files WHERE short_name IS NOT NULL ORDER BY created_at ASC"
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
    results.push({ id: f.id, name: f.short_name || f.subject, color, soft, icon, topics });
  }
  return results;
}

export type TopicFileNode = { fileId: string; fileName: string; topics: string[] };
export type SubjectHierarchyNode = { shortName: string; files: TopicFileNode[] };

// 3-level picker: Subject (short_name) → Chapter (file) → Topic (chunk heading).
// Pass a short_name to restrict to a single subject (used by the teacher route).
export async function topicHierarchy(filterShortName?: string): Promise<SubjectHierarchyNode[]> {
  const rows = await query<{ file_id: string; file_name: string; short_name: string; topics: string[] }>(
    `SELECT sf.id AS file_id, sf.name AS file_name,
            COALESCE(sf.short_name, sf.subject) AS short_name,
            array_agg(DISTINCT sc.heading) AS topics
       FROM syllabus_files sf
       JOIN syllabus_chunks sc ON sc.file_id = sf.id
      WHERE sc.heading != 'Intro'
        AND sf.short_name IS NOT NULL
        AND COALESCE(sf.short_name, sf.subject) NOT IN ('IB Framework', 'Knowledge Index')
        AND sf.name NOT IN ('00-IB-framework-reference.md', '00-index.md')
        -- Drop metadata/section-group headings; keep real topics (e.g. "Concept: …").
        AND sc.heading NOT LIKE '(%)'
        AND sc.heading NOT ILIKE '%Knowledge Base%'
        AND sc.heading NOT ILIKE '%Subject Overview%'
        AND sc.heading NOT ILIKE '%Cross-Subject%'
        AND sc.heading NOT ILIKE '%MYP Global Contexts%'
        AND sc.heading NOT ILIKE '%assessment criteria%'
        AND sc.heading NOT ILIKE '%Command-Term%'
        AND sc.heading NOT ILIKE 'Subject-Wide%'
        AND sc.heading NOT ILIKE 'The four MYP%'
        AND sc.heading NOT ILIKE '%Related Concepts%'
        AND sc.heading <> sf.subject
        AND sc.heading <> COALESCE(sf.short_name, sf.subject)
        ${filterShortName ? "AND COALESCE(sf.short_name, sf.subject) = $1" : ""}
      GROUP BY sf.id, sf.name, sf.short_name, sf.subject
      ORDER BY short_name, file_name`,
    filterShortName ? [filterShortName] : []
  );
  const subjects: SubjectHierarchyNode[] = [];
  for (const r of rows) {
    const topics = [...(r.topics || [])].sort((a, b) => a.localeCompare(b));
    let subj = subjects.find((s) => s.shortName === r.short_name);
    if (!subj) { subj = { shortName: r.short_name, files: [] }; subjects.push(subj); }
    subj.files.push({ fileId: r.file_id, fileName: r.file_name, topics });
  }
  return subjects;
}

export async function retrieve(
  query_str: string,
  k = 4,
  gradeLevelId?: string
): Promise<{ file: string; heading: string; text: string }[]> {
  const qt = tokenize(query_str);
  if (!qt.length) return [];
  // Grade teachers and admins pass no gradeLevelId → they retrieve across every grade.
  const chunks = await query<{ file_name: string; heading: string; body: string; tf: string }>(
    gradeLevelId
      ? "SELECT file_name, heading, body, tf FROM syllabus_chunks WHERE grade_level_id = $1"
      : "SELECT file_name, heading, body, tf FROM syllabus_chunks",
    gradeLevelId ? [gradeLevelId] : []
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
