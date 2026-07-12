"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Wall from "@/components/Wall";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const PRIMARY = "#4C43D9";
const BG = "#EFEAE0";
const CARD = "#fff";
const BORDER = "#E7E1D6";
const DANGER = "#C0392B";
const DARK = "#23201B";

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

// IB 1-7 color coding
function ibColor(grade: number | null): string {
  if (grade == null) return "#9A907E";
  if (grade <= 2) return "#C0392B";
  if (grade <= 4) return "#E8823A";
  if (grade <= 6) return "#2E9E6B";
  return "#1E7A4E";
}

function safeHttpUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
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
  const initial = childName.trim().charAt(0).toUpperCase() || "?";

  const cardStyle: React.CSSProperties = {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  };

  return (
    <div style={{ minHeight: "100vh", background: BG }}>
      {/* Header bar */}
      <div style={{ background: DARK, color: "#fff", padding: "14px 20px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: PRIMARY,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontSize: 20,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            J
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>
              Jarvis Guardian Portal
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }}>Signed in as {guardianName}</div>
          </div>
          <button
            onClick={() => void logout()}
            style={{
              background: DANGER,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "8px 16px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
        {!child ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: DARK }}>
              No student is linked to your account yet
            </div>
            <div style={{ color: "#6A6152", marginTop: 8 }}>
              Ask your school admin to link your child so you can follow their progress.
            </div>
          </div>
        ) : (
          <>
            {/* Overview */}
            <div
              style={{
                background: "linear-gradient(135deg,#4C43D9,#7A5AC2)",
                borderRadius: 16,
                padding: 22,
                marginBottom: 16,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                gap: 18,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
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
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>
                  {childName}
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
                  <span style={{ color: "rgba(255,255,255,.85)" }}>
                    {subjects.length} subject{subjects.length === 1 ? "" : "s"} · Overall IB Grade:
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 30,
                      height: 28,
                      padding: "0 8px",
                      borderRadius: 8,
                      background: ibColor(overallAvg),
                      color: "#fff",
                      fontWeight: 800,
                      fontFamily: DISPLAY,
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
                        padding: "3px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      ⚑ {flagCount} flag{flagCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {lastActive && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,.7)" }}>
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
                    <div
                      key={s.subjectName}
                      style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 0" }}
                    >
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
                        <div style={{ marginTop: 10, paddingLeft: 4 }}>
                          {topics.length === 0 ? (
                            <div style={{ color: "#6A6152", fontSize: 13 }}>No topic detail available.</div>
                          ) : (
                            topics.map((t) => {
                              const tKey = `${s.subjectName}::${t.topic_name ?? ""}`;
                              const tOpen = expandedTopic === tKey;
                              return (
                                <div key={t.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                                  <button
                                    onClick={() => void toggleTopic(s.subjectName, t.topic_name)}
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                      padding: "8px 0",
                                      fontSize: 13,
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      textAlign: "left",
                                      color: !t.confirmed ? DANGER : "#3A342B",
                                    }}
                                  >
                                    <span style={{ fontWeight: 600, minWidth: 24 }}>{t.criterion}</span>
                                    <span style={{ flex: 1 }}>
                                      {t.topic_name || t.criterion_name || "—"}
                                      {!t.confirmed && (
                                        <span style={{ color: DANGER, fontWeight: 600 }}>
                                          {" "}
                                          ⚑ awaiting confirmation
                                        </span>
                                      )}
                                    </span>
                                    <span style={{ color: "#6A6152" }}>
                                      {t.raw_score != null ? `${t.raw_score}/8` : "–"}
                                    </span>
                                    <span style={{ color: "#9A907E", fontSize: 11 }}>{tOpen ? "▲" : "▼"}</span>
                                  </button>
                                  {tOpen && <TeacherContent items={teacherContent[tKey] ?? []} />}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Wall (read-only) */}
            <div style={cardStyle}>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: DARK, marginBottom: 4 }}>
                Messages from teachers
              </div>
              <div style={{ color: "#6A6152", fontSize: 13, marginBottom: 12 }}>
                Updates your child&apos;s teachers have shared. You can read but not reply here.
              </div>
              <Wall role="guardian" readOnly />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
