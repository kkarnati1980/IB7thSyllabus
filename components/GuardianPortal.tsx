"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Wall from "@/components/Wall";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const PRIMARY = "#4C43D9";
const BG = "#EFEAE0";
const CARD = "#fff";
const BORDER = "#E7E1D6";
const DANGER = "#C0392B";

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

// IB 1-7 color coding
function ibColor(grade: number | null): string {
  if (grade == null) return "#9A907E";
  if (grade <= 2) return "#C0392B";
  if (grade <= 4) return "#E8823A";
  if (grade <= 6) return "#2E9E6B";
  return "#1E7A4E";
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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

export default function GuardianPortal({
  child,
  guardianName,
}: {
  child: Child;
  guardianName: string;
}) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [details, setDetails] = useState<Record<string, Assessment[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
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

      // Fetch per-subject topic detail (powers expansion + timeline) — small subject count.
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

  const overallAvg = useMemo(() => {
    const vals = subjects.map((s) => s.overall).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [subjects]);

  const timeline = useMemo(() => {
    const all: { subjectName: string; a: Assessment }[] = [];
    for (const [subjectName, list] of Object.entries(details)) {
      for (const a of list) {
        if (a.topic_name && a.updated_at) all.push({ subjectName, a });
      }
    }
    all.sort((x, y) => new Date(y.a.updated_at).getTime() - new Date(x.a.updated_at).getTime());
    return all.slice(0, 15);
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
    <div style={{ minHeight: "100vh", background: BG, padding: "24px 16px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: "#2B2620" }}>
            Guardian Portal
          </div>
          <div style={{ color: "#6A6152", fontSize: 14 }}>Signed in as {guardianName}</div>
        </div>

        {!child ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: "#2B2620" }}>
              No student is linked to your account yet
            </div>
            <div style={{ color: "#6A6152", marginTop: 8 }}>
              Ask your school admin to link your child so you can follow their progress.
            </div>
          </div>
        ) : (
          <>
            {/* Overview */}
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: PRIMARY,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: DISPLAY,
                  fontSize: 24,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: "#2B2620" }}>
                  {childName}
                </div>
                <div style={{ color: "#6A6152", fontSize: 13 }}>
                  {subjects.length} subject{subjects.length === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6A6152", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Overall
                </div>
                <div style={{ marginTop: 4 }}>
                  <GradePill grade={overallAvg} />
                </div>
              </div>
            </div>

            {/* Subjects */}
            <div style={cardStyle}>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: "#2B2620", marginBottom: 12 }}>
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
                        <span style={{ flex: 1, fontWeight: 600, color: "#2B2620" }}>{s.subjectName}</span>
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
                            topics.map((t) => (
                              <div
                                key={t.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  padding: "6px 0",
                                  fontSize: 13,
                                  color: !t.confirmed ? DANGER : "#3A342B",
                                }}
                              >
                                <span style={{ fontWeight: 600, minWidth: 24 }}>{t.criterion}</span>
                                <span style={{ flex: 1 }}>
                                  {t.topic_name || t.criterion_name || "—"}
                                  {!t.confirmed && (
                                    <span style={{ color: DANGER, fontWeight: 600 }}> · unconfirmed</span>
                                  )}
                                </span>
                                <span style={{ color: "#6A6152" }}>
                                  {t.raw_score != null ? `${t.raw_score}/8` : "–"}
                                </span>
                              </div>
                            ))
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
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: "#2B2620", marginBottom: 12 }}>
                Messages
              </div>
              <Wall role="guardian" readOnly />
            </div>

            {/* Progress timeline */}
            <div style={cardStyle}>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: "#2B2620", marginBottom: 12 }}>
                Recent activity
              </div>
              {timeline.length === 0 ? (
                <div style={{ color: "#6A6152", fontSize: 13 }}>No recent activity yet.</div>
              ) : (
                timeline.map(({ subjectName, a }) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderTop: `1px solid ${BORDER}`,
                      fontSize: 13,
                    }}
                  >
                    <GradePill grade={a.overall_1_7} />
                    <span style={{ flex: 1, color: "#3A342B" }}>
                      <strong>{subjectName}</strong> · {a.topic_name} ({a.criterion}
                      {a.raw_score != null ? ` ${a.raw_score}/8` : ""})
                    </span>
                    <span style={{ color: "#9A907E" }}>{timeAgo(a.updated_at)}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
