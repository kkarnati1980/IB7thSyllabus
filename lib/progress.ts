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
