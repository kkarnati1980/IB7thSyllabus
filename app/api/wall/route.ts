import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";
import { getAllowedRecipients, type Recipient } from "@/lib/wall-recipients";

export const runtime = "nodejs";

// Parse @mentions from free text. @all wins → broadcast. Otherwise the FIRST
// resolved @Name (matched against allowed recipients' name/displayName,
// case-insensitive) becomes the single DM target.
function resolveMention(
  content: string,
  recipients: Recipient[]
): { broadcast: boolean; toUserId: string | null } {
  if (/@all\b/i.test(content)) return { broadcast: true, toUserId: null };
  const lower = content.toLowerCase();
  let best: { idx: number; id: string } | null = null;
  for (const r of recipients) {
    for (const label of [r.name, r.displayName]) {
      if (!label) continue;
      const idx = lower.indexOf("@" + label.toLowerCase());
      if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, id: r.id };
    }
  }
  return { broadcast: false, toUserId: best ? best.id : null };
}

type WallRow = {
  id: string;
  content: string;
  created_at: string;
  from_name: string;
  from_role: string;
  to_user_id: string | null;
  subject_context: string | null;
  grade_context: string | null;
};

const SELECT = `SELECT wm.id, wm.content, wm.created_at, u.name AS from_name, u.role AS from_role,
                       wm.to_user_id, wm.subject_context, wm.grade_context
                  FROM wall_messages wm JOIN users u ON u.id = wm.from_user_id`;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    let where = "";
    let params: unknown[] = [];

    if (user.role === "admin") {
      where = "TRUE";
    } else if (user.role === "student") {
      where = "wm.to_user_id = $1 OR (wm.to_user_id IS NULL AND (wm.grade_context = '7' OR wm.subject_context IS NOT NULL))";
      params = [user.id];
    } else if (user.role === "guardian") {
      const child = await queryOne<{ id: string }>(
        "SELECT id FROM users WHERE guardian_id = $1 AND role = 'student' LIMIT 1",
        [user.id]
      );
      if (child) {
        // Direct DMs to the guardian, teacher→child DMs, and child's broadcasts.
        where = `wm.to_user_id = $1
              OR (wm.to_user_id = $2 AND u.role IN ('grade_teacher', 'subject_teacher'))
              OR (wm.to_user_id IS NULL AND (wm.grade_context = '7' OR wm.subject_context IS NOT NULL))`;
        params = [user.id, child.id];
      } else {
        where = "wm.to_user_id = $1";
        params = [user.id];
      }
    } else if (user.role === "grade_teacher") {
      where = "wm.grade_context = '7' OR wm.subject_context IS NOT NULL OR wm.to_user_id = $1 OR wm.from_user_id = $1";
      params = [user.id];
    } else if (user.role === "subject_teacher") {
      const subs = await query<{ subject_name: string }>(
        "SELECT subject_name FROM subject_assignments WHERE teacher_id = $1",
        [user.id]
      );
      params = [user.id];
      where = "wm.to_user_id = $1 OR wm.from_user_id = $1";
      if (subs.length) {
        const placeholders = subs.map((_, i) => `$${i + 2}`).join(", ");
        where += ` OR wm.subject_context IN (${placeholders})`;
        params.push(...subs.map((s) => s.subject_name));
      }
    } else {
      return NextResponse.json({ messages: [] });
    }

    const messages = await query<WallRow>(
      `${SELECT} WHERE ${where} ORDER BY wm.created_at DESC`,
      params
    );
    return NextResponse.json({ messages });
  } catch (e) {
    console.error("wall GET failed", e);
    return NextResponse.json({ error: "Failed to load wall" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "guardian") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      content?: string;
      toUserId?: string;
      subjectContext?: string;
      gradeContext?: string;
    };
    const content = (body.content ?? "").trim();
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

    // Resolve the target: parse @mentions first, else fall back to explicit
    // body fields (back-compat with older portals).
    const recipients = await getAllowedRecipients(user);
    const byId = new Map(recipients.map((r) => [r.id, r]));
    const mention = resolveMention(content, recipients);

    let toUserId: string | null;
    if (mention.broadcast) {
      toUserId = null;
    } else if (mention.toUserId) {
      toUserId = mention.toUserId;
    } else {
      toUserId = body.toUserId ?? null;
    }

    // A resolved DM target must be inside the caller's allowed set.
    if (toUserId && !byId.has(toUserId)) {
      return NextResponse.json({ error: "Recipient not allowed" }, { status: 403 });
    }
    const targetRole = toUserId ? byId.get(toUserId)!.role : null;
    const broadcast = !toUserId;

    let subjectContext: string | null = null;
    let gradeContext: string | null = null;

    if (user.role === "student") {
      // Students may only DM a teacher or their guardian — never broadcast, never a peer.
      if (broadcast) {
        return NextResponse.json({ error: "Students must message a teacher or guardian" }, { status: 403 });
      }
      if (!["subject_teacher", "grade_teacher", "guardian", "admin"].includes(targetRole ?? "")) {
        return NextResponse.json({ error: "Students may only message teachers or their guardian" }, { status: 403 });
      }
    } else if (user.role === "subject_teacher") {
      if (broadcast) {
        // Broadcast lands on an assigned subject wall (never grade-wide).
        const subs = await query<{ subject_name: string }>(
          "SELECT subject_name FROM subject_assignments WHERE teacher_id = $1 AND grade_level_id = 'grade_7_iish' ORDER BY subject_name",
          [user.id]
        );
        if (!subs.length) return NextResponse.json({ error: "Not assigned to any subject" }, { status: 403 });
        const wanted = body.subjectContext;
        subjectContext = wanted && subs.some((s) => s.subject_name === wanted) ? wanted : subs[0].subject_name;
      } else if (targetRole !== "student" && targetRole !== "guardian") {
        return NextResponse.json({ error: "Subject teachers may only DM students or guardians" }, { status: 403 });
      }
    } else if (user.role === "grade_teacher") {
      // May DM anyone in grade or broadcast grade-wide.
      if (broadcast) gradeContext = "7";
    } else if (user.role === "admin") {
      if (broadcast) gradeContext = "7";
    }

    const id = uid("wm");
    await execute(
      `INSERT INTO wall_messages (id, from_user_id, to_user_id, subject_context, grade_context, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, user.id, toUserId, subjectContext, gradeContext, content, nowIso()]
    );

    // Direct message to a student → drop a notification so their bell lights up.
    if (toUserId && targetRole === "student") {
      await execute(
        `INSERT INTO student_notifications (id, user_id, type, content, from_user_id, created_at)
         VALUES ($1, $2, 'message', $3, $4, $5)`,
        [uid("ntf"), toUserId, content, user.id, nowIso()]
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error("wall POST failed", e);
    return NextResponse.json({ error: "Failed to post message" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as { messageId?: string };
    if (!body.messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

    // wall_messages has no read flag — mark the caller's matching notification read if one exists.
    const msg = await queryOne<{ from_user_id: string; content: string }>(
      "SELECT from_user_id, content FROM wall_messages WHERE id = $1",
      [body.messageId]
    );
    if (msg) {
      await execute(
        `UPDATE student_notifications SET read = true
          WHERE user_id = $1 AND from_user_id = $2 AND content = $3 AND read = false`,
        [user.id, msg.from_user_id, msg.content]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("wall PATCH failed", e);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
