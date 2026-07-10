import { db } from "./db";
import type { ProgressEntry } from "./types";

export function getProgress(userId: string): ProgressEntry[] {
  const rows = db
    .prepare("SELECT * FROM progress WHERE user_id = ?")
    .all(userId) as {
    topic_id: string;
    topic_name: string;
    subject: string;
    icon: string;
    color: string;
    mastery: number;
    misconceptions: string;
    last_seen: number;
  }[];
  return rows.map((r) => ({
    topicId: r.topic_id,
    topicName: r.topic_name,
    subject: r.subject,
    icon: r.icon,
    color: r.color,
    mastery: r.mastery,
    misconceptions: JSON.parse(r.misconceptions || "[]"),
    lastSeen: r.last_seen,
  }));
}

export function updateProgress(
  userId: string,
  entry: {
    topicId: string;
    topicName: string;
    subject: string;
    icon: string;
    color: string;
    masteryDelta: number;
    misconceptions?: string[];
  }
): ProgressEntry {
  const prior = db
    .prepare("SELECT mastery, misconceptions FROM progress WHERE user_id = ? AND topic_id = ?")
    .get(userId, entry.topicId) as { mastery: number; misconceptions: string } | undefined;

  const priorMastery = prior?.mastery ?? 0;
  const mastery = Math.max(0, Math.min(100, priorMastery + (entry.masteryDelta || 0)));
  const misc: string[] = prior ? JSON.parse(prior.misconceptions || "[]") : [];
  for (const m of entry.misconceptions || []) {
    if (m && !misc.includes(m)) misc.push(m);
  }
  const lastSeen = Date.now();

  db.prepare(
    `INSERT INTO progress (user_id, topic_id, topic_name, subject, icon, color, mastery, misconceptions, last_seen)
     VALUES (@userId, @topicId, @topicName, @subject, @icon, @color, @mastery, @misconceptions, @lastSeen)
     ON CONFLICT(user_id, topic_id) DO UPDATE SET
       mastery = @mastery, misconceptions = @misconceptions, last_seen = @lastSeen,
       topic_name = @topicName, subject = @subject, icon = @icon, color = @color`
  ).run({
    userId,
    topicId: entry.topicId,
    topicName: entry.topicName,
    subject: entry.subject,
    icon: entry.icon,
    color: entry.color,
    mastery,
    misconceptions: JSON.stringify(misc),
    lastSeen,
  });

  return {
    topicId: entry.topicId,
    topicName: entry.topicName,
    subject: entry.subject,
    icon: entry.icon,
    color: entry.color,
    mastery,
    misconceptions: misc,
    lastSeen,
  };
}

export function trackerSummary(userId: string): string {
  const rows = getProgress(userId);
  if (!rows.length) return "New learner, no history yet.";
  return rows.map((r) => `${r.topicName}: ${r.mastery}% mastery`).join("; ");
}
