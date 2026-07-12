import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, nowIso, query, queryOne, uid } from "@/lib/db";

export const runtime = "nodejs";

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
      if (!child) return NextResponse.json({ messages: [] });
      where = "wm.to_user_id = $1 OR (wm.to_user_id IS NULL AND (wm.grade_context = '7' OR wm.subject_context IS NOT NULL))";
      params = [child.id];
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

    // Scope-gate the broadcast/DM fields by role so a caller can't exceed their reach.
    let toUserId = body.toUserId ?? null;
    let subjectContext = body.subjectContext ?? null;
    let gradeContext = body.gradeContext ?? null;
    let targetRole: string | null = null;
    if (toUserId) {
      const target = await queryOne<{ role: string }>("SELECT role FROM users WHERE id = $1", [toUserId]);
      if (!target) return NextResponse.json({ error: "Recipient not found" }, { status: 400 });
      targetRole = target.role;
    }

    if (user.role === "student") {
      // Students may join a subject wall or DM a teacher — never grade-wide, never DM a peer.
      gradeContext = null;
      if (toUserId && !["subject_teacher", "grade_teacher", "admin"].includes(targetRole ?? "")) {
        return NextResponse.json({ error: "Students may only message teachers" }, { status: 403 });
      }
    } else if (user.role === "subject_teacher") {
      gradeContext = null; // grade-wide broadcast is the grade teacher's scope
      if (subjectContext) {
        const ok = await queryOne(
          "SELECT 1 FROM subject_assignments WHERE teacher_id = $1 AND subject_name = $2 AND grade_level_id = 'grade_7_iish'",
          [user.id, subjectContext]
        );
        if (!ok) return NextResponse.json({ error: "Not assigned to that subject" }, { status: 403 });
      }
      if (toUserId && targetRole !== "student") {
        return NextResponse.json({ error: "Teachers may only DM students" }, { status: 403 });
      }
    } else if (user.role === "grade_teacher") {
      if (gradeContext) gradeContext = "7"; // only grade 7 exists
    }
    // admin: unrestricted

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
