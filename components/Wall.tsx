"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type Recipient = { id: string; name: string; role: string; displayName: string };

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
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canPost = role !== "guardian" && !readOnly;
  const isTeacher = role === "subject_teacher" || role === "grade_teacher";

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

  useEffect(() => {
    if (!canPost) return;
    fetch("/api/wall/recipients")
      .then((r) => (r.ok ? r.json() : { recipients: [] }))
      .then((j) => setRecipients(Array.isArray(j.recipients) ? j.recipients : []))
      .catch(() => {});
  }, [canPost]);

  // Build the mention menu: filter recipients by the word after "@", plus @all for teachers.
  const q = mentionQuery.toLowerCase();
  const mentionOptions: { label: string; sub: string }[] = [];
  if (isTeacher && "all".startsWith(q)) mentionOptions.push({ label: "all", sub: "Broadcast to everyone" });
  for (const r of recipients) {
    if (r.displayName.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) {
      mentionOptions.push({ label: r.displayName, sub: r.role.replace("_", " ") });
      if (mentionOptions.length >= 8) break;
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    setContent(val);
    setCaret(pos);
    const m = val.slice(0, pos).match(/@([^\s@]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  }

  function insertMention(label: string) {
    const before = content.slice(0, caret).replace(/@([^\s@]*)$/, "@" + label + " ");
    const next = before + content.slice(caret);
    setContent(next);
    setMentionOpen(false);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  async function post() {
    if (!content.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (!r.ok) {
        setError("Could not send message");
        return;
      }
      setContent("");
      setMentionOpen(false);
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
          <div style={{ position: "relative" }}>
            <textarea
              ref={taRef}
              value={content}
              onChange={onChange}
              onKeyDown={(e) => {
                if (mentionOpen && mentionOptions.length && e.key === "Enter") {
                  e.preventDefault();
                  insertMention(mentionOptions[0].label);
                  return;
                }
                if (e.key === "Escape") setMentionOpen(false);
                if (e.key === "Enter" && !e.shiftKey && !mentionOpen) {
                  e.preventDefault();
                  post();
                }
              }}
              placeholder={
                isTeacher ? "Write a message… use @name or @all" : "Write a message… use @name"
              }
              rows={2}
              style={{
                width: "100%",
                border: "1px solid #E0D9CC",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                resize: "none",
                fontFamily: "'Bricolage Grotesque',system-ui,sans-serif",
                boxSizing: "border-box",
              }}
            />
            {mentionOpen && mentionOptions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  background: "#fff",
                  border: "1px solid #E7E1D6",
                  borderRadius: 10,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                  zIndex: 20,
                  overflow: "hidden",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {mentionOptions.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(o.label);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid #F1ECE2",
                      padding: "9px 12px",
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "'Bricolage Grotesque',system-ui,sans-serif",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#23201B" }}>@{o.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#A79E8E" }}>{o.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
