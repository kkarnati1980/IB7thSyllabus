"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Wall from "@/components/Wall";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

type TabKey = "overview" | "teachers" | "wall" | "settings";

type SubjectTeacher = {
  id: string;
  name: string;
  email: string;
  subjects: string[];
  contentCount: number;
};

type OverviewData = {
  students: { id: string; name: string }[];
  subjects: string[];
  grid: Record<string, Record<string, number>>;
};

type TopicDetail = {
  topicId: string;
  topicName: string;
  criteria: Record<string, number>;
  overall: number;
};
type SubjectDetail = {
  subjectName: string;
  overall: number;
  criteria: { A: number; B: number; C: number; D: number };
  topics: TopicDetail[];
};
type StudentDetail = {
  student: { id: string; name: string };
  subjects: SubjectDetail[];
  flags: { id: string; topicName: string; subjectName: string; reason: string; createdAt: string }[];
};

type Channel = {
  id: string;
  channel_name: string;
  channel_keywords: string;
  grade_level_id: string | null;
  added_by: string | null;
  created_at: string;
};

// IB 1-7 colour bands — solid badge fill per design system.
function gradeColor(g: number | undefined): { bg: string; fg: string } {
  if (g === undefined) return { bg: "#EDE7DA", fg: "#A79E8E" };
  if (g <= 2) return { bg: "#C0392B", fg: "#fff" };
  if (g <= 4) return { bg: "#E8823A", fg: "#fff" };
  if (g <= 6) return { bg: "#2E9E6B", fg: "#fff" };
  return { bg: "#1A6B47", fg: "#fff" };
}

export default function GradeTeacherPortal({
  user,
  subjectTeachers,
  assessedBySubject,
}: {
  user: { id: string; name: string; email: string };
  subjectTeachers: SubjectTeacher[];
  assessedBySubject: Record<string, number>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("overview");

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [ovLoading, setOvLoading] = useState(true);
  const [ovError, setOvError] = useState("");

  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailSubject, setDetailSubject] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setOvLoading(true);
    setOvError("");
    try {
      const r = await fetch("/api/grade-teacher/overview");
      if (!r.ok) {
        setOvError("Could not load the grade overview.");
        return;
      }
      setOverview(await r.json());
    } catch {
      setOvError("Could not load the grade overview.");
    } finally {
      setOvLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  async function openStudent(studentId: string, subjectName: string) {
    setDetailLoading(true);
    setDetailSubject(subjectName);
    setDetail(null);
    try {
      const r = await fetch(`/api/grade-teacher/student/${studentId}`);
      if (r.ok) setDetail(await r.json());
    } catch {
      /* leave detail null → panel shows an error state */
    } finally {
      setDetailLoading(false);
    }
  }

  function closeStudent() {
    setDetail(null);
    setDetailSubject(null);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  const navBtn = (key: TabKey): React.CSSProperties => ({
    width: 52,
    height: 52,
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontSize: 20,
    background: tab === key ? "#4C43D9" : "transparent",
    color: tab === key ? "#fff" : "#8A8172",
  });

  // Stats derived entirely from the already-fetched overview grid — no extra network calls.
  // ponytail: no grade-wide "active flags" endpoint exists for this role, so this counts
  // red-band (IB 1-2) cells as a proxy for "needs attention". Swap for a real aggregate if
  // a /api/grade-teacher/flags-style endpoint is ever added.
  const totalStudents = overview?.students.length ?? 0;
  const totalSubjects = overview?.subjects.length ?? 0;
  let flagCount = 0;
  let gradeSum = 0;
  let gradeN = 0;
  if (overview) {
    for (const st of overview.students) {
      for (const s of overview.subjects) {
        const g = overview.grid[st.id]?.[s];
        if (g === undefined) continue;
        gradeSum += g;
        gradeN += 1;
        if (g <= 2) flagCount += 1;
      }
    }
  }
  const gradeAvg = gradeN > 0 ? (gradeSum / gradeN).toFixed(1) : "–";

  return (
    <div style={{ minHeight: "100vh", background: "#EFEAE0", display: "flex" }}>
      {/* LEFT SIDEBAR */}
      <div
        style={{
          width: 88,
          flex: "0 0 88px",
          background: "#23201B",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "22px 0",
          gap: 8,
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div
          title={`${user.name} · ${user.email}`}
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            background: "linear-gradient(150deg,#8A6FE0,#4C43D9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontWeight: 800,
            color: "#fff",
            fontSize: 22,
            boxShadow: "0 6px 18px rgba(76,67,217,.5)",
            marginBottom: 14,
          }}
        >
          J
        </div>
        <button onClick={() => setTab("overview")} title="Grade Overview" style={navBtn("overview")}>⌂</button>
        <button onClick={() => setTab("teachers")} title="Subject Teachers" style={navBtn("teachers")}>👤</button>
        <button onClick={() => setTab("wall")} title="Wall" style={navBtn("wall")}>💬</button>
        <button onClick={() => setTab("settings")} title="Settings" style={navBtn("settings")}>⚙️</button>
        <div style={{ flex: 1 }} />
        <div
          style={{
            background: "#3A362E",
            color: "#B7B2E8",
            borderRadius: 10,
            padding: "7px 4px",
            fontSize: 10,
            fontWeight: 800,
            textAlign: "center",
            width: 52,
            letterSpacing: 0.4,
          }}
        >
          GRADE 7
        </div>
        <button onClick={logout} title="Logout" style={{ width: 52, height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 18, background: "transparent", color: "#8A8172", marginTop: 4 }}>⏻</button>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, minWidth: 0, padding: 32, overflowY: "auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>Grade 7 Teacher Portal</div>
          <div style={{ fontSize: 13, color: "#8A8172", marginTop: 2 }}>{user.name} · {user.email}</div>
        </div>

        {tab === "overview" && (
          <div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
              <StatTile label="Total Students" value={totalStudents} color="#4C43D9" />
              <StatTile label="Total Subjects" value={totalSubjects} color="#4C43D9" />
              <StatTile label="Active Flags" value={flagCount} color="#C0392B" />
              <StatTile label="Grade Avg IB" value={gradeAvg} color="#2E9E6B" />
            </div>

            {ovLoading && <EmptyNote icon="⏳" title="Loading grade overview…" />}
            {!ovLoading && ovError && <EmptyNote icon="⚠️" title={ovError} />}
            {!ovLoading && !ovError && overview && overview.students.length === 0 && (
              <EmptyNote icon="🎒" title="No students linked to the school yet." sub="Ask an admin to link students on the school roster." />
            )}
            {!ovLoading && !ovError && overview && overview.students.length > 0 && (
              <GradeGrid overview={overview} onCell={openStudent} />
            )}
          </div>
        )}

        {tab === "teachers" && (
          <SubjectTeachers teachers={subjectTeachers} assessedBySubject={assessedBySubject} onMessage={() => setTab("wall")} />
        )}

        {tab === "wall" && <Wall role="grade_teacher" />}

        {tab === "settings" && <ChannelSettings />}
      </div>

      {(detail || detailLoading) && detailSubject && (
        <StudentDrawer
          loading={detailLoading}
          detail={detail}
          focusSubject={detailSubject}
          onClose={closeStudent}
          onFlagged={() => loadOverview()}
        />
      )}
    </div>
  );
}

/* ===== Grade Overview grid ===== */
function GradeGrid({
  overview,
  onCell,
}: {
  overview: OverviewData;
  onCell: (studentId: string, subjectName: string) => void;
}) {
  const { students, subjects, grid } = overview;
  const cell: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #F1ECE2", textAlign: "center", fontSize: 13 };

  // Sort by overall IB grade desc — average of the subjects that have a recorded grade.
  const sorted = [...students].sort((a, b) => {
    const avg = (id: string) => {
      const vals = subjects.map((s) => grid[id]?.[s]).filter((v): v is number => v !== undefined);
      return vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : -1;
    };
    return avg(b.id) - avg(a.id);
  });

  return (
    <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 20, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>
        Grade overview — IB grade (1–7) per subject · click a cell for detail
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: "left", position: "sticky", left: 0, background: "#fff", fontWeight: 700, color: "#5A5347", minWidth: 160 }}>Student</th>
              {subjects.map((s) => (
                <th key={s} style={{ ...cell, fontWeight: 700, color: "#5A5347", minWidth: 88 }} title={s}>{shortSubject(s)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((st) => (
              <tr key={st.id}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 700, position: "sticky", left: 0, background: "#fff" }}>{st.name}</td>
                {subjects.map((s) => {
                  const g = grid[st.id]?.[s];
                  const c = gradeColor(g);
                  return (
                    <td key={s} style={cell}>
                      <button
                        onClick={() => onCell(st.id, s)}
                        title={`${st.name} · ${s}`}
                        style={{ width: 40, height: 34, borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 15, background: c.bg, color: c.fg }}
                      >
                        {g ?? "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== Student drawer (drill-down) — 400px slide-in from the right ===== */
function StudentDrawer({
  loading,
  detail,
  focusSubject,
  onClose,
  onFlagged,
}: {
  loading: boolean;
  detail: StudentDetail | null;
  focusSubject: string;
  onClose: () => void;
  onFlagged: () => void;
}) {
  const subject = detail?.subjects.find((s) => s.subjectName === focusSubject) ?? null;
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"" | "sending" | "sent" | "error">("");
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagState, setFlagState] = useState<"" | "sending" | "sent" | "error">("");

  async function sendNote() {
    if (!note.trim() || !detail) return;
    setNoteState("sending");
    try {
      const r = await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note.trim(), toUserId: detail.student.id }),
      });
      if (!r.ok) { setNoteState("error"); return; }
      setNote("");
      setNoteState("sent");
      setTimeout(() => setNoteState(""), 2500);
    } catch {
      setNoteState("error");
    }
  }

  async function flagTopic(topic: TopicDetail) {
    if (!flagReason.trim() || !detail || !subject) return;
    setFlagState("sending");
    try {
      const r = await fetch("/api/grade-teacher/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: detail.student.id,
          topicId: topic.topicId,
          topicName: topic.topicName,
          subjectName: subject.subjectName,
          reason: flagReason.trim(),
        }),
      });
      if (!r.ok) { setFlagState("error"); return; }
      setFlagState("sent");
      setFlagReason("");
      setFlagFor(null);
      onFlagged();
      setTimeout(() => setFlagState(""), 2500);
    } catch {
      setFlagState("error");
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(35,32,27,.45)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(400px, 100%)", background: "#EFEAE0", height: "100%", overflowY: "auto", boxShadow: "-8px 0 30px rgba(0,0,0,.18)" }}
      >
        <div style={{ position: "sticky", top: 0, background: "#23201B", color: "#fff", padding: "16px 22px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>{detail?.student.name ?? "Student"}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{focusSubject}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(255,255,255,.3)", color: "#fff", borderRadius: 12, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {loading && <EmptyNote icon="⏳" title="Loading student…" />}

          {!loading && !detail && <EmptyNote icon="⚠️" title="Could not load this student." />}

          {!loading && detail && !subject && (
            <EmptyNote icon="📭" title={`No ${focusSubject} assessments yet.`} sub="This student has no recorded scores for this subject." />
          )}

          {!loading && detail && subject && (
            <>
              {/* subject summary */}
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <GradePill g={subject.overall} />
                  <div>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>{subject.subjectName}</div>
                    <div style={{ fontSize: 12, color: "#8A8172" }}>Overall IB grade (best per criterion)</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  {(["A", "B", "C", "D"] as const).map((c) => (
                    <div key={c} style={{ background: "#F6F3EC", borderRadius: 10, padding: "8px 14px", textAlign: "center", minWidth: 56 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8A8172" }}>Criterion {c}</div>
                      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, color: "#4C43D9" }}>{subject.criteria[c]}<span style={{ fontSize: 11, color: "#A79E8E" }}>/8</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* topics */}
              <Card>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Topics</div>
                {subject.topics.length === 0 && <div style={{ fontSize: 13, color: "#8A8172" }}>No topic-level scores recorded.</div>}
                {subject.topics.map((t) => {
                  const c = gradeColor(t.overall);
                  return (
                    <div key={t.topicId} style={{ borderTop: "1px solid #F1ECE2", padding: "12px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ background: c.bg, color: c.fg, borderRadius: 8, padding: "3px 9px", fontWeight: 800, fontSize: 13 }}>{t.overall}</span>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{t.topicName}</span>
                        <button onClick={() => { setFlagFor(flagFor === t.topicId ? null : t.topicId); setFlagReason(""); }} style={{ background: "#FBE9DC", color: "#B5561F", border: "none", borderRadius: 12, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🚩 Flag</button>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {(["A", "B", "C", "D"] as const).map((cr) => (
                          <span key={cr} style={{ fontSize: 11, color: "#5A5347", background: "#F6F3EC", borderRadius: 7, padding: "3px 8px" }}>{cr}: {t.criteria[cr] ?? 0}/8</span>
                        ))}
                      </div>
                      {flagFor === t.topicId && (
                        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                          <input
                            value={flagReason}
                            onChange={(e) => setFlagReason(e.target.value)}
                            placeholder="Why is this topic flagged?"
                            style={{ flex: 1, border: "1px solid #E0D9CC", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}
                          />
                          <button onClick={() => flagTopic(t)} disabled={flagState === "sending" || !flagReason.trim()} style={{ background: flagState === "sending" || !flagReason.trim() ? "#EBCBB2" : "#E8823A", color: "#fff", border: "none", borderRadius: 12, padding: "0 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                            {flagState === "sending" ? "…" : "Flag"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {flagState === "sent" && <div style={{ fontSize: 12, color: "#2E9E6B", marginTop: 8, fontWeight: 600 }}>Topic flagged — the student was notified.</div>}
                {flagState === "error" && <div style={{ fontSize: 12, color: "#C0392B", marginTop: 8, fontWeight: 600 }}>Could not flag the topic.</div>}
              </Card>

              {/* existing unresolved flags */}
              {detail.flags.length > 0 && (
                <Card>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Open flags ({detail.flags.length})</div>
                  {detail.flags.map((f) => (
                    <div key={f.id} style={{ borderTop: "1px solid #F1ECE2", padding: "10px 0", fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>{f.subjectName} · {f.topicName}</div>
                      <div style={{ color: "#8A8172" }}>{f.reason}</div>
                    </div>
                  ))}
                </Card>
              )}

              {/* send a note */}
              <Card>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Send a note to {detail.student.name}</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write a private message to this student…"
                  rows={3}
                  style={{ width: "100%", border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 14, resize: "none", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                  <button onClick={sendNote} disabled={noteState === "sending" || !note.trim()} style={{ background: noteState === "sending" || !note.trim() ? "#B7B2E8" : "#4C43D9", color: "#fff", border: "none", borderRadius: 12, padding: "9px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                    {noteState === "sending" ? "Sending…" : "Send note"}
                  </button>
                  {noteState === "sent" && <span style={{ fontSize: 13, color: "#2E9E6B", fontWeight: 600 }}>Sent ✓</span>}
                  {noteState === "error" && <span style={{ fontSize: 13, color: "#C0392B", fontWeight: 600 }}>Could not send.</span>}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== Subject Teachers tab ===== */
function SubjectTeachers({
  teachers,
  assessedBySubject,
  onMessage,
}: {
  teachers: SubjectTeacher[];
  assessedBySubject: Record<string, number>;
  onMessage: (teacherName: string) => void;
}) {
  if (teachers.length === 0) {
    return <EmptyNote icon="👩‍🏫" title="No subject teachers yet." sub="Ask an admin to create subject-teacher accounts." />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(240px, 1fr))", gap: 18 }}>
      {teachers.map((t) => (
        <Card key={t.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#ECEBFB", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: DISPLAY, color: "#4C43D9", fontSize: 17 }}>{(t.name || "?")[0].toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: "#8A8172", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.email}</div>
            </div>
            <button onClick={() => onMessage(t.name)} title={`Message ${t.name}`} style={{ background: "#F3F1FB", color: "#4C43D9", border: "none", borderRadius: 12, width: 34, height: 34, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>💬</button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5A5347", marginBottom: 6 }}>Subjects ({t.subjects.length})</div>
          {t.subjects.length === 0 ? (
            <div style={{ fontSize: 13, color: "#A79E8E", marginBottom: 10 }}>No subjects assigned.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {t.subjects.map((s) => (
                <span key={s} style={{ background: "#F3F1FB", color: "#4C43D9", borderRadius: 20, padding: "5px 11px", fontSize: 12, fontWeight: 700 }}>
                  {shortSubject(s)} · {assessedBySubject[s] ?? 0} 🎓
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid #F1ECE2", paddingTop: 12 }}>
            <MiniStat label="Resources added" value={t.contentCount} color="#2E9E6B" />
            <MiniStat label="Students assessed" value={t.subjects.reduce((n, s) => Math.max(n, assessedBySubject[s] ?? 0), 0)} color="#4C43D9" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ===== Settings tab — grade-level video channel management ===== */
function ChannelSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/channels");
      if (!r.ok) { setError("Could not load channels."); return; }
      const data = await r.json();
      setChannels(data.channels ?? []);
    } catch {
      setError("Could not load channels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  async function addChannel() {
    if (!name.trim() || !keywords.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const r = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName: name.trim(), channelKeywords: keywords.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setAddError(d.error || "Could not add channel.");
        return;
      }
      setName("");
      setKeywords("");
      await loadChannels();
    } catch {
      setAddError("Could not add channel.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteChannel(id: string) {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/channels?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok) await loadChannels();
    } catch {
      /* leave the list as-is on failure */
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      <Card>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Video channels — Grade 7</div>
        <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 14 }}>Controls which YouTube channels students can pull revision videos from.</div>

        {loading && <div style={{ fontSize: 13, color: "#8A8172" }}>Loading…</div>}
        {!loading && error && <div style={{ fontSize: 13, color: "#C0392B" }}>{error}</div>}
        {!loading && !error && channels.length === 0 && <div style={{ fontSize: 13, color: "#8A8172" }}>No channels configured.</div>}

        {!loading && !error && channels.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #F1ECE2", padding: "10px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{c.added_by === null && "🔒 "}{c.channel_name}</div>
              <div style={{ fontSize: 12, color: "#8A8172", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.channel_keywords}</div>
            </div>
            {c.added_by !== null && (
              <button
                onClick={() => deleteChannel(c.id)}
                disabled={deletingId === c.id}
                style={{ background: "#FDECEA", color: "#C0392B", border: "none", borderRadius: 12, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                {deletingId === c.id ? "…" : "Delete"}
              </button>
            )}
          </div>
        ))}
      </Card>

      <Card>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Add a channel</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name"
            style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
          />
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Keywords (comma-separated)"
            style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={addChannel}
              disabled={adding || !name.trim() || !keywords.trim()}
              style={{ background: adding || !name.trim() || !keywords.trim() ? "#B7B2E8" : "#4C43D9", color: "#fff", border: "none", borderRadius: 12, padding: "9px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              {adding ? "Adding…" : "Add channel"}
            </button>
            {addError && <span style={{ fontSize: 12, color: "#C0392B", fontWeight: 600 }}>{addError}</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ===== small shared bits ===== */
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 20, padding: 18 }}>{children}</div>;
}

function GradePill({ g }: { g: number }) {
  const c = gradeColor(g);
  return <div style={{ width: 46, height: 46, borderRadius: 12, background: c.bg, color: c.fg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{g}</div>;
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, background: "#F6F3EC", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8A8172" }}>{label}</div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ flex: "1 1 160px", background: "#fff", border: "1px solid #E7E1D6", borderRadius: 20, padding: "18px 20px" }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8A8172", fontWeight: 700, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function EmptyNote({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: "center", padding: 44, color: "#8A8172" }}>
      <div style={{ fontSize: 34 }}>{icon}</div>
      <div style={{ fontWeight: 700, marginTop: 8, color: "#5A5347" }}>{title}</div>
      {sub && <div style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function shortSubject(s: string): string {
  const map: Record<string, string> = {
    "Language and Literature": "Lang & Lit",
    "Language Acquisition": "Lang Acq",
    "Individuals and Societies": "Ind & Soc",
    "Physical and Health Education": "PHE",
  };
  return map[s] ?? s;
}
