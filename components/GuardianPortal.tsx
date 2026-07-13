"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { stripMentionPrefix } from "@/lib/mentions";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const PRIMARY = "#4C43D9";
const PRIMARY_LIGHT = "#6B62F5";
const SUCCESS = "#2E9E6B";
const WARNING = "#E8823A";
const DANGER = "#C0392B";
const BG = "#EFEAE0";
const CARD = "#fff";
const BORDER = "#E7E1D6";
const DARK = "#23201B";
const MUTED = "#8A8172";

type Child = { id: string; name: string; display_name: string | null } | null;

type SubjectRow = {
  subjectName: string;
  overall: number | null;
  criteria: Record<string, number | null>;
};

type Assessment = {
  id: string;
  criterion: string;
  raw_score: number | null;
  overall_1_7: number | null;
  confirmed: boolean;
  topic_id: string | null;
  topic_name: string | null;
  updated_at: string;
  criterion_name: string | null;
};

type TeacherContentItem = { id: string; title: string; content_type: string; content: string };

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
  grade_teacher: PRIMARY,
  subject_teacher: "#2F6FDE",
  admin: PRIMARY,
  student: MUTED,
  guardian: MUTED,
};

const ROLE_LABEL: Record<string, string> = {
  grade_teacher: "Grade Teacher",
  subject_teacher: "Subject Teacher",
  admin: "Admin",
  student: "Student",
  guardian: "Guardian",
};

// IB 1-7 color coding
function ibColor(grade: number | null): string {
  if (grade == null) return "#9A907E";
  if (grade <= 2) return DANGER;
  if (grade <= 4) return WARNING;
  if (grade <= 6) return SUCCESS;
  return "#1E7A4E";
}

function masteryColor(pct: number | null): string {
  if (pct == null) return "#9A907E";
  if (pct < 40) return DANGER;
  if (pct < 70) return WARNING;
  return SUCCESS;
}

function safeHttpUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

function GradePill({ grade }: { grade: number | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 34,
        height: 34,
        padding: "0 8px",
        borderRadius: 10,
        background: ibColor(grade),
        color: "#fff",
        fontWeight: 700,
        fontFamily: DISPLAY,
      }}
    >
      {grade ?? "–"}
    </span>
  );
}

/* ===== FROM YOUR TEACHER (matches StudentApp) ===== */
function TeacherContent({ items }: { items: TeacherContentItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 13,
          color: PRIMARY,
          marginBottom: 10,
          textTransform: "uppercase",
          letterSpacing: ".06em",
        }}
      >
        📚 From your teacher
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((c) => {
          if (c.content_type === "image") {
            const src = safeHttpUrl(c.content);
            if (!src) return null;
            return (
              <div key={c.id} style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${BORDER}`, background: "#fff" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={c.title} style={{ width: "100%", maxHeight: 300, objectFit: "cover", display: "block" }} />
                <div style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600, color: DARK }}>{c.title}</div>
              </div>
            );
          }
          if (c.content_type === "video") {
            const href = safeHttpUrl(c.content);
            if (!href) return null;
            return (
              <a
                key={c.id}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                style={{ display: "block", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, padding: "14px 16px", textDecoration: "none" }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FDECEA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flex: "0 0 42px" }}>▶</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: DARK, lineHeight: 1.3 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: "#4A453C", marginTop: 4, lineHeight: 1.45, wordBreak: "break-all" }}>{c.content}</div>
                  </div>
                  <div style={{ color: DANGER, fontSize: 16, flex: "0 0 16px" }}>↗</div>
                </div>
              </a>
            );
          }
          return (
            <div key={c.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, padding: "14px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: "#4A453C", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.content}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NAV_ITEMS: { key: "overview" | "messages"; icon: string; label: string }[] = [
  { key: "overview", icon: "⌂", label: "Overview" },
  { key: "messages", icon: "💬", label: "Messages" },
];

export default function GuardianPortal({
  child,
  guardianName,
}: {
  child: Child;
  guardianName: string;
}) {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [details, setDetails] = useState<Record<string, Assessment[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [teacherContent, setTeacherContent] = useState<Record<string, TeacherContentItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "messages">("overview");
  const [messages, setMessages] = useState<WallMessage[]>([]);

  const childId = child?.id ?? null;

  const load = useCallback(async () => {
    if (!childId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/assessments?userId=${encodeURIComponent(childId)}&all=true`, {
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as { subjects?: SubjectRow[] };
      const rows = Array.isArray(j.subjects) ? j.subjects : [];
      setSubjects(rows);

      // Fetch per-subject topic detail (powers expansion + flags + last-active) — small subject count.
      const pairs = await Promise.all(
        rows.map(async (s): Promise<[string, Assessment[]]> => {
          try {
            const dr = await fetch(
              `/api/assessments?userId=${encodeURIComponent(childId)}&subjectName=${encodeURIComponent(
                s.subjectName
              )}`,
              { credentials: "same-origin" }
            );
            if (!dr.ok) return [s.subjectName, []];
            const dj = (await dr.json()) as { assessments?: Assessment[] };
            return [s.subjectName, Array.isArray(dj.assessments) ? dj.assessments : []];
          } catch {
            return [s.subjectName, []];
          }
        })
      );
      setDetails(Object.fromEntries(pairs));
    } catch (e) {
      console.error("guardian assessments load failed", e);
      setError("Could not load your child's progress right now.");
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read-only message wall — same endpoint/shape as the compose-capable Wall component.
  const loadMessages = useCallback(async () => {
    if (!child) return;
    try {
      const r = await fetch("/api/wall");
      if (!r.ok) return;
      const j = await r.json();
      setMessages(Array.isArray(j.messages) ? j.messages : []);
    } catch {
      /* keep last-known messages on transient failure */
    }
  }, [child]);

  useEffect(() => {
    void loadMessages();
    const t = setInterval(loadMessages, 30000);
    return () => clearInterval(t);
  }, [loadMessages]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (e) {
      console.error("logout failed", e);
    }
    router.push("/");
  }, [router]);

  // Expand a topic and lazily fetch its "From your teacher" content.
  const toggleTopic = useCallback(
    async (subjectName: string, topicName: string | null) => {
      const key = `${subjectName}::${topicName ?? ""}`;
      if (expandedTopic === key) {
        setExpandedTopic(null);
        return;
      }
      setExpandedTopic(key);
      if (!topicName || teacherContent[key]) return;
      try {
        const r = await fetch(
          `/api/teacher/content?subjectName=${encodeURIComponent(subjectName)}&topicName=${encodeURIComponent(
            topicName
          )}&visible=true`,
          { credentials: "same-origin" }
        );
        if (!r.ok) return;
        const j = (await r.json()) as { content?: TeacherContentItem[] };
        setTeacherContent((prev) => ({ ...prev, [key]: Array.isArray(j.content) ? j.content : [] }));
      } catch (e) {
        console.error("teacher content load failed", e);
      }
    },
    [expandedTopic, teacherContent]
  );

  const overallAvg = useMemo(() => {
    const vals = subjects.map((s) => s.overall).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [subjects]);

  // Unresolved flags = unconfirmed assessments across all subjects.
  const flagCount = useMemo(
    () => Object.values(details).reduce((n, list) => n + list.filter((a) => !a.confirmed).length, 0),
    [details]
  );

  const lastActive = useMemo(() => {
    let max = 0;
    for (const list of Object.values(details)) {
      for (const a of list) {
        const t = new Date(a.updated_at).getTime();
        if (Number.isFinite(t) && t > max) max = t;
      }
    }
    return max ? new Date(max).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  }, [details]);

  const childName = child?.display_name || child?.name || "";
  const childInitial = childName.trim().charAt(0).toUpperCase() || "?";

  const cardStyle: React.CSSProperties = {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, fontFamily: DISPLAY }}>
      {/* Sidebar — this IS the navigation, no separate header bar */}
      <div
        style={{
          width: 88,
          flexShrink: 0,
          background: DARK,
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "20px 0",
          gap: 22,
          zIndex: 10,
        }}
      >
        <div
          title={`Jarvis Guardian Portal · Signed in as ${guardianName}`}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: PRIMARY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontSize: 20,
            fontWeight: 800,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          J
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", alignItems: "center" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                title={item.label}
                style={{
                  width: 64,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  padding: "8px 0",
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                  background: isActive ? PRIMARY : "transparent",
                  color: isActive ? "#fff" : "rgba(255,255,255,.6)",
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div
          title={childName || "No child linked"}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: PRIMARY,
            border: "2px solid rgba(255,255,255,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontSize: 16,
            fontWeight: 800,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {childInitial}
        </div>

        <button
          onClick={() => void logout()}
          title="Logout"
          style={{
            width: 64,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            padding: "8px 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: DANGER,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>⎋</span>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Logout</span>
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, marginLeft: 88, padding: 32, overflowY: "auto" }}>
        {!child ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: DARK }}>
              No student is linked to your account yet
            </div>
            <div style={{ color: "#6A6152", marginTop: 8 }}>
              Ask your school admin to link your child so you can follow their progress.
            </div>
          </div>
        ) : activeTab === "overview" ? (
          <>
            {/* Child overview card */}
            <div
              style={{
                background: `linear-gradient(135deg, ${PRIMARY}, ${PRIMARY_LIGHT})`,
                borderRadius: 20,
                padding: 24,
                marginBottom: 20,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                gap: 20,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,.18)",
                  border: "2px solid rgba(255,255,255,.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: DISPLAY,
                  fontSize: 28,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {childInitial}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>
                    {childName}
                  </div>
                  <span
                    style={{
                      background: "rgba(255,255,255,.18)",
                      border: "1px solid rgba(255,255,255,.35)",
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Grade 7
                  </span>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                  <span style={{ color: "rgba(255,255,255,.85)" }}>
                    {subjects.length} subject{subjects.length === 1 ? "" : "s"} · Overall IB Grade
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 34,
                      height: 32,
                      padding: "0 8px",
                      borderRadius: 10,
                      background: ibColor(overallAvg),
                      color: "#fff",
                      fontWeight: 800,
                      fontFamily: DISPLAY,
                      fontSize: 16,
                    }}
                  >
                    {overallAvg ?? "–"}
                  </span>
                  {flagCount > 0 && (
                    <span
                      style={{
                        background: DANGER,
                        color: "#fff",
                        borderRadius: 20,
                        padding: "4px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      ⚑ {flagCount} topic{flagCount === 1 ? "" : "s"} flagged for revision
                    </span>
                  )}
                </div>
                {lastActive && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,.7)" }}>
                    Last active {lastActive}
                  </div>
                )}
              </div>
            </div>

            {/* Subjects */}
            <div style={cardStyle}>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: DARK, marginBottom: 12 }}>
                Subjects
              </div>
              {loading ? (
                <div style={{ color: "#6A6152" }}>Loading…</div>
              ) : error ? (
                <div style={{ color: DANGER }}>{error}</div>
              ) : subjects.length === 0 ? (
                <div style={{ color: "#6A6152" }}>No subjects recorded yet.</div>
              ) : (
                subjects.map((s) => {
                  const isOpen = expanded === s.subjectName;
                  const topics = details[s.subjectName] ?? [];
                  const subjectFlags = topics.filter((t) => !t.confirmed).length;
                  return (
                    <div key={s.subjectName} style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 0" }}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : s.subjectName)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: "#EFEDFC",
                            color: PRIMARY,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: DISPLAY,
                            fontWeight: 800,
                            fontSize: 15,
                            flexShrink: 0,
                          }}
                        >
                          {s.subjectName.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <GradePill grade={s.overall} />
                        <span style={{ flex: 1, fontWeight: 600, color: DARK, display: "flex", alignItems: "center", gap: 8 }}>
                          {s.subjectName}
                          {subjectFlags > 0 && (
                            <span style={{ color: DANGER, fontSize: 12, fontWeight: 700 }}>⚑ {subjectFlags}</span>
                          )}
                        </span>
                        <span style={{ display: "flex", gap: 6 }}>
                          {(["A", "B", "C", "D"] as const).map((c) => (
                            <span
                              key={c}
                              title={`Criterion ${c}`}
                              style={{
                                fontSize: 12,
                                color: "#6A6152",
                                border: `1px solid ${BORDER}`,
                                borderRadius: 6,
                                padding: "2px 6px",
                              }}
                            >
                              {c}
                              {s.criteria?.[c] != null ? ` ${s.criteria[c]}` : " –"}
                            </span>
                          ))}
                        </span>
                        <span style={{ color: "#9A907E", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div style={{ marginTop: 12, paddingLeft: 4 }}>
                          {topics.length === 0 ? (
                            <div style={{ color: "#6A6152", fontSize: 13 }}>No topic detail available.</div>
                          ) : (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                                gap: 12,
                              }}
                            >
                              {topics.map((t) => {
                                const tKey = `${s.subjectName}::${t.topic_name ?? ""}`;
                                const tOpen = expandedTopic === tKey;
                                const mastery = t.raw_score != null ? Math.round((t.raw_score / 8) * 100) : null;
                                return (
                                  <div
                                    key={t.id}
                                    style={{
                                      border: `1px solid ${!t.confirmed ? "#F3D2CC" : BORDER}`,
                                      borderRadius: 14,
                                      padding: 12,
                                      background: !t.confirmed ? "#FCF4F2" : "#FAF8F4",
                                    }}
                                  >
                                    <button
                                      onClick={() => void toggleTopic(s.subjectName, t.topic_name)}
                                      style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 0,
                                        textAlign: "left",
                                      }}
                                    >
                                      <span style={{ fontWeight: 700, fontSize: 12, color: "#6A6152", minWidth: 18 }}>{t.criterion}</span>
                                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: DARK }}>
                                        {t.topic_name || t.criterion_name || "—"}
                                      </span>
                                      <span style={{ color: "#9A907E", fontSize: 11 }}>{tOpen ? "▲" : "▼"}</span>
                                    </button>

                                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ flex: 1, height: 6, borderRadius: 4, background: BORDER, overflow: "hidden" }}>
                                        <div
                                          style={{
                                            width: `${mastery ?? 0}%`,
                                            height: "100%",
                                            background: masteryColor(mastery),
                                          }}
                                        />
                                      </div>
                                      <span style={{ fontSize: 11, color: "#6A6152", flexShrink: 0 }}>
                                        {mastery != null ? `${mastery}% mastery` : "no score"}
                                      </span>
                                    </div>

                                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontSize: 11, color: "#6A6152" }}>IB contribution</span>
                                      <GradePill grade={t.overall_1_7} />
                                    </div>

                                    {!t.confirmed && (
                                      <div style={{ marginTop: 8, fontSize: 12, color: DANGER, lineHeight: 1.4 }}>
                                        ⚑ Awaiting teacher confirmation · {new Date(t.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                      </div>
                                    )}

                                    {tOpen && <TeacherContent items={teacherContent[tKey] ?? []} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div style={cardStyle}>
            <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: DARK, marginBottom: 4 }}>
              Messages from teachers
            </div>
            <div style={{ color: "#6A6152", fontSize: 13, marginBottom: 16 }}>
              Updates your child&apos;s teachers have shared. You can read but not reply here.
            </div>

            {messages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 12px", color: MUTED }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 14 }}>No messages yet. Teachers will send updates here.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ display: "flex", gap: 12, background: "#FAF8F4", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "12px 14px" }}>
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: ROLE_COLOR[m.from_role] ?? MUTED,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: DISPLAY,
                        fontWeight: 800,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {(m.from_name || "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: DARK }}>{m.from_name}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#fff",
                            background: ROLE_COLOR[m.from_role] ?? MUTED,
                            borderRadius: 8,
                            padding: "2px 8px",
                          }}
                        >
                          {ROLE_LABEL[m.from_role] ?? m.from_role}
                        </span>
                        {m.subject_context && <span style={{ fontSize: 11, color: MUTED }}>· {m.subject_context}</span>}
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "#A79E8E" }}>{timeAgo(m.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 14, lineHeight: 1.5, color: "#3A362E", whiteSpace: "pre-wrap" }}>
                        {stripMentionPrefix(m.content)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
