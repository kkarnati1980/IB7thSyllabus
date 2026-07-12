"use client";

import { useCallback, useEffect, useState } from "react";

type WallMessage = {
  id: string;
  content: string;
  created_at: string;
  from_name: string;
  from_role: string;
  to_user_id: string | null;
  subject_context: string | null;
  grade_context: string | null;
};

const ROLE_COLOR: Record<string, string> = {
  grade_teacher: "#7A5AC2",
  subject_teacher: "#4C43D9",
  admin: "#4C43D9",
  student: "#888",
  guardian: "#888",
};

const ROLE_LABEL: Record<string, string> = {
  grade_teacher: "Grade Teacher",
  subject_teacher: "Subject Teacher",
  admin: "Admin",
  student: "Student",
  guardian: "Guardian",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Wall({
  role,
  subjectContext,
  readOnly,
}: {
  role: "student" | "subject_teacher" | "grade_teacher" | "guardian";
  subjectContext?: string;
  readOnly?: boolean;
}) {
  const [messages, setMessages] = useState<WallMessage[]>([]);
  const [content, setContent] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wall");
      if (!r.ok) return;
      const j = await r.json();
      setMessages(Array.isArray(j.messages) ? j.messages : []);
    } catch {
      /* keep last-known messages on transient failure */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const canPost = role !== "guardian" && !readOnly;

  async function post() {
    if (!content.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const body: Record<string, string> = { content: content.trim() };
      if (recipient.trim()) body.toUserId = recipient.trim();
      else if (subjectContext) body.subjectContext = subjectContext;
      else body.gradeContext = "7";
      const r = await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setError("Could not send message");
        return;
      }
      setContent("");
      setRecipient("");
      await load();
    } catch {
      setError("Could not send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#8A8172", fontSize: 14 }}>
            No messages yet.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              background: "#fff",
              border: "1px solid #E7E1D6",
              borderRadius: 14,
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#23201B" }}>{m.from_name}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  background: ROLE_COLOR[m.from_role] ?? "#888",
                  borderRadius: 8,
                  padding: "2px 8px",
                }}
              >
                {ROLE_LABEL[m.from_role] ?? m.from_role}
              </span>
              {m.subject_context && (
                <span style={{ fontSize: 11, color: "#8A8172" }}>· {m.subject_context}</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#A79E8E" }}>
                {timeAgo(m.created_at)}
              </span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "#3A362E", whiteSpace: "pre-wrap" }}>
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {canPost && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E7E1D6",
            borderRadius: 14,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {(role === "subject_teacher" || role === "grade_teacher") && (
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                subjectContext
                  ? `Broadcast to all ${subjectContext} students (or enter a student ID)`
                  : "Broadcast to the whole grade (or enter a student ID)"
              }
              style={{
                border: "1px solid #E0D9CC",
                borderRadius: 10,
                padding: "9px 11px",
                fontSize: 13,
              }}
            />
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                post();
              }
            }}
            placeholder="Write a message…"
            rows={2}
            style={{
              border: "1px solid #E0D9CC",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              resize: "none",
            }}
          />
          {error && <div style={{ fontSize: 12, color: "#C0392B" }}>{error}</div>}
          <button
            onClick={post}
            disabled={sending || !content.trim()}
            style={{
              alignSelf: "flex-end",
              background: sending || !content.trim() ? "#B7B2E8" : "#4C43D9",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "9px 18px",
              fontWeight: 700,
              fontSize: 14,
              cursor: sending || !content.trim() ? "default" : "pointer",
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
