/**
 * Reads the local jarvis.db SQLite and generates Supabase-compatible SQL files.
 * Run from repo root: node dump-to-supabase.js
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'jarvis.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('ERROR: data/jarvis.db not found. Run ingest.js first.');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

function esc(s) {
  return String(s).replace(/'/g, "''");
}

// --- Read files ---
const files = db.prepare('SELECT id, name, subject, created_at FROM syllabus_files ORDER BY created_at ASC').all();
console.log('Files found: ' + files.length);

// --- Read chunks ---
const chunks = db.prepare('SELECT id, file_id, file_name, heading, body, tf FROM syllabus_chunks').all();
console.log('Chunks found: ' + chunks.length);

db.close();

// --- Part 1: clear + files ---
const outDir = path.join(process.cwd(), 'supabase-sql');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

let p1 = 'DELETE FROM syllabus_chunks;\nDELETE FROM syllabus_files;\n\n';
p1 += 'INSERT INTO syllabus_files (id, name, subject, created_at) VALUES\n';
p1 += files.map(f => `('${esc(f.id)}','${esc(f.name)}','${esc(f.subject)}','${esc(f.created_at)}')`).join(',\n');
p1 += ';';
fs.writeFileSync(path.join(outDir, 'seed-01.sql'), p1);
console.log('Written seed-01.sql (' + p1.length + ' chars)');

// --- Parts 2+: chunks in batches of 30 ---
const BATCH = 30;
let part = 2;
for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  let sql = 'INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf) VALUES\n';
  sql += batch.map(c =>
    `('${esc(c.id)}','${esc(c.file_id)}','${esc(c.file_name)}','${esc(c.heading)}','${esc(c.body)}','${esc(c.tf)}'::jsonb)`
  ).join(',\n');
  sql += ';';
  const fname = `seed-${String(part).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(outDir, fname), sql);
  part++;
}

console.log(`Written seed-02.sql through seed-${String(part - 1).padStart(2, '0')}.sql`);
console.log(`\nDone. Run all ${part - 1} files in order in Supabase SQL Editor.`);
console.log('Files are in: ' + outDir);
