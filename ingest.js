const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const db = new Database('data/jarvis.db');
const RAG_DIR = '/Users/kishore/Codex_Development/IB7thSyllabus/Advaith_7th_Grade_RAG';

function uid(prefix) {
  return prefix + '_' + randomBytes(9).toString('hex');
}

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2);
}

const files = fs.readdirSync(RAG_DIR).filter(f => f.endsWith('.md'));

for (const name of files) {
  const text = fs.readFileSync(path.join(RAG_DIR, name), 'utf8');
  const titleMatch = text.match(/^#\s*(.+)/m);
  const subject = titleMatch ? titleMatch[1].split(':')[0].trim() : name.replace(/\.md$/i, '');
  const fileId = uid('file');
  const now = new Date().toISOString();
  const parts = text.split(/\n(?=#{1,3}\s)/);

  db.transaction(() => {
    db.prepare('INSERT INTO syllabus_files (id, name, subject, created_at) VALUES (?, ?, ?, ?)').run(fileId, name, subject, now);
    let count = 0;
    for (const p of parts) {
      const hm = p.match(/^#{1,3}\s*(.+)/);
      const heading = hm ? hm[1].trim() : 'Intro';
      const body = p.replace(/^#{1,3}\s*.+\n?/, '').trim();
      if (!body) continue;
      const tf = {};
      for (const w of tokenize(p)) tf[w] = (tf[w] || 0) + 1;
      db.prepare('INSERT INTO syllabus_chunks (id, file_id, file_name, heading, body, tf) VALUES (?, ?, ?, ?, ?, ?)').run(uid('chunk'), fileId, name, heading, body, JSON.stringify(tf));
      count++;
    }
    console.log(name + ' -> ' + subject + ' (' + count + ' chunks)');
  })();
}

const total = db.prepare('SELECT COUNT(*) AS n FROM syllabus_chunks').get();
console.log('Done. Total chunks:', total.n);
