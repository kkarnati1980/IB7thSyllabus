import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const RAG_DIR = path.join(process.cwd(), "Advaith_7th_Grade_RAG");

function uid(prefix: string) { return `${prefix}_${randomBytes(9).toString("hex")}`; }
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM syllabus_chunks");
    await client.query("DELETE FROM syllabus_files");
    console.log("Cleared existing data");

    const files = fs.readdirSync(RAG_DIR).filter((f) => f.endsWith(".md"));
    for (const name of files) {
      const text = fs.readFileSync(path.join(RAG_DIR, name), "utf8");
      const titleMatch = text.match(/^#\s*(.+)/m);
      const subject = titleMatch ? titleMatch[1].split(":")[0].trim() : name.replace(/\.md$/i, "");
      const fileId = uid("file");
      const now = new Date().toISOString();
      const parts = text.split(/\n(?=#{1,3}\s)/);

      await client.query("BEGIN");
      await client.query(
        "INSERT INTO syllabus_files (id, name, subject, created_at) VALUES ($1, $2, $3, $4)",
        [fileId, name, subject, now]
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
      console.log(`${name} -> ${subject} (${count} chunks)`);
    }
    const { rows } = await client.query("SELECT COUNT(*) AS n FROM syllabus_chunks");
    console.log(`Done. Total chunks: ${rows[0].n}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
