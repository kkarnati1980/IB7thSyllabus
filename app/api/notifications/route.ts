import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { execute, query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

type FlagRow = {
  id: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
  reason: string;
  created_at: string;
};

type NotifRow = {
  id: string;
  type: string;
  content: string;
  from_user_id: string | null;
  from_name: string | null;
  read: boolean;
  created_at: string;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const flags = await query<FlagRow>(
      `SELECT id, topic_id, topic_name, subject_name, reason, created_at
         FROM topic_flags WHERE user_id = $1 AND resolved = false ORDER BY created_at DESC`,
      [user.id]
    );
    const messages = await query<NotifRow>(
      `SELECT n.id, n.type, n.content, n.from_user_id, u.name AS from_name, n.read, n.created_at
         FROM student_notifications n
         LEFT JOIN users u ON u.id = n.from_user_id
        WHERE n.user_id = $1 ORDER BY n.created_at DESC`,
      [user.id]
    );
    const unread = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM student_notifications WHERE user_id = $1 AND read = false",
      [user.id]
    );
    return NextResponse.json({ flags, messages, unreadCount: Number(unread?.count ?? 0) });
  } catch (e) {
    console.error("notifications GET failed", e);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as { notificationId?: string };
    if (!body.notificationId) {
      return NextResponse.json({ error: "notificationId required" }, { status: 400 });
    }
    await execute(
      "UPDATE student_notifications SET read = true WHERE id = $1 AND user_id = $2",
      [body.notificationId, user.id]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("notifications PATCH failed", e);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}
