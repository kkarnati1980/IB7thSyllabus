"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Wall from "@/components/Wall";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const PRIMARY = "#4C43D9";
const SUCCESS = "#2E9E6B";
const WARNING = "#E8823A";
const DANGER = "#C0392B";
const BG = "#EFEAE0";
const CARD = "#fff";
const BORDER = "#E7E1D6";
const DARK = "#23201B";
const MUTED = "#8A8172";

type Topic = { id: string; name: string };
type SyllabusSubject = { name: string; topics: Topic[] };
type Student = { id: string; name: string; grades: Record<string, number> };
type Assessment = {
  id: string;
  criterion: string;
  raw_score: number;
  overall_1_7: number;
  confirmed: boolean;
  topic_id: string;
  topic_name: string;
  criterion_name: string | null;
};
type Content = {
  id: string;
  subject_name: string;
  topic_name: string;
  content_type: string;
  content: string;
  title: string;
  visible: boolean;
  created_at: string;
};
type Criterion = {
  id: string;
  subject_name: string;
  criterion: string;
  criterion_name: string;
  max_score: number;
};
type Flag = {
  id: string;
  user_id: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
  reason: string;
  resolved: boolean;
  created_at: string;
};
type Channel = {
  id: string;
  channel_name: string;
  channel_keywords: string;
  grade_level_id: string | null;
  added_by: string | null;
  created_at: string;
};

type TabKey = "students" | "content" | "criteria" | "wall" | "settings";

const card: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 20,
  padding: 16,
};
const inputStyle: React.CSSProperties = {
  border: "1px solid #E0D9CC",
  borderRadius: 10,
  padding: "9px 11px",
  fontSize: 13,
  fontFamily: "inherit",
};
const btn = (bg: string): React.CSSProperties => ({
  background: bg,
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "8px 14px",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
});

function gradeColor(g: number): string {
  if (g >= 6) return SUCCESS;
  if (g >= 4) return PRIMARY;
  if (g >= 3) return WARNING;
  return DANGER;
}

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "students", label: "My Students", icon: "👥" },
  { key: "content", label: "Topic Content", icon: "📚" },
  { key: "criteria", label: "MYP Criteria", icon: "◆" },
  { key: "wall", label: "Wall", icon: "💬" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

export default function SubjectTeacherPortal({
  user,
  syllabus,
}: {
  user: { id: string; name: string; email: string };
  syllabus: SyllabusSubject[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("students");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>("");

  // Students tab
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [drillStudent, setDrillStudent] = useState<Student | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [drillSubject, setDrillSubject] = useState<string>("");
  const [loadingDrill, setLoadingDrill] = useState(false);
  const [flagModal, setFlagModal] = useState<{ topicId: string; topicName: string } | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flags, setFlags] = useState<Flag[]>([]);

  // Content tab
  const [content, setContent] = useState<Content[]>([]);
  const [chapters, setChapters] = useState<{ fileId: string; fileName: string; topics: string[] }[]>([]);
  const [cFileId, setCFileId] = useState("");
  const [cTopic, setCTopic] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cType, setCType] = useState("text");
  const [cBody, setCBody] = useState("");
  const [cBusy, setCBusy] = useState(false);

  // Criteria tab
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [critEdits, setCritEdits] = useState<Record<string, string>>({});

  // Settings tab (allowed video channels)
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelKeywords, setNewChannelKeywords] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);

  // 3-level cascade: the teacher's subject → its chapters (files) → topics (headings).
  // Keyed by short_name (the assigned subject value), which the client-side `syllabus`
  // prop (keyed by verbose subject) can't match.
  const loadChapters = useCallback(async (subjectName: string) => {
    setCFileId("");
    setCTopic("");
    if (!subjectName) {
      setChapters([]);
      return;
    }
    try {
      const r = await fetch(`/api/teacher/topic-picker?subjectName=${encodeURIComponent(subjectName)}`);
      if (r.ok) {
        const j = (await r.json()) as { subjects: { shortName: string; files: { fileId: string; fileName: string; topics: string[] }[] }[] };
        setChapters(j.subjects?.[0]?.files ?? []);
      } else {
        setChapters([]);
      }
    } catch {
      setChapters([]);
    }
  }, []);

  const loadStudents = useCallback(async () => {
    setLoadingStudents(true);
    try {
      const r = await fetch("/api/teacher/students");
      if (r.ok) {
        const j = (await r.json()) as { students: Student[]; subjects: string[] };
        setStudents(j.students ?? []);
        setSubjects(j.subjects ?? []);
        if (j.subjects?.length && !selectedSubject) setSelectedSubject(j.subjects[0]);
      }
    } catch {
      /* keep last-known */
    } finally {
      setLoadingStudents(false);
    }
  }, [selectedSubject]);

  // Powers the "Active Flags" stat tile and the per-student flag count column.
  const loadFlags = useCallback(async () => {
    try {
      const r = await fetch("/api/teacher/flags");
      if (r.ok) {
        const j = (await r.json()) as { flags: Flag[] };
        setFlags(j.flags ?? []);
      }
    } catch {
      /* keep last-known */
    }
  }, []);

  useEffect(() => {
    loadStudents();
    loadFlags();
  }, [loadStudents, loadFlags]);

  async function openDrill(student: Student, subjectName: string) {
    setDrillStudent(student);
    setDrillSubject(subjectName);
    setLoadingDrill(true);
    setAssessments([]);
    try {
      const r = await fetch(
        `/api/assessments?userId=${encodeURIComponent(student.id)}&subjectName=${encodeURIComponent(subjectName)}`
      );
      if (r.ok) {
        const j = (await r.json()) as { assessments: Assessment[] };
        setAssessments(j.assessments ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingDrill(false);
    }
  }

  async function saveScore(a: Assessment, rawScore: number) {
    const clamped = Math.max(0, Math.min(8, rawScore));
    try {
      const r = await fetch("/api/assessments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: a.id, rawScore: clamped, confirmed: true }),
      });
      if (r.ok && drillStudent) await openDrill(drillStudent, drillSubject);
    } catch {
      /* ignore */
    }
  }

  async function submitFlag() {
    if (!flagModal || !drillStudent || !flagReason.trim()) return;
    try {
      await fetch("/api/teacher/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: drillStudent.id,
          topicId: flagModal.topicId,
          topicName: flagModal.topicName,
          subjectName: drillSubject,
          reason: flagReason.trim(),
        }),
      });
    } catch {
      /* ignore */
    } finally {
      setFlagModal(null);
      setFlagReason("");
      loadFlags();
    }
  }

  const loadContent = useCallback(async (subjectName: string) => {
    if (!subjectName) return;
    try {
      const r = await fetch(`/api/teacher/content?subjectName=${encodeURIComponent(subjectName)}`);
      if (r.ok) {
        const j = (await r.json()) as { content: Content[] };
        setContent(j.content ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadCriteria = useCallback(async (subjectName: string) => {
    if (!subjectName) return;
    try {
      const r = await fetch(`/api/teacher/criteria?subjectName=${encodeURIComponent(subjectName)}`);
      if (r.ok) {
        const j = (await r.json()) as { criteria: Criterion[] };
        setCriteria(j.criteria ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (tab === "content") {
      loadContent(selectedSubject);
      loadChapters(selectedSubject);
    }
    if (tab === "criteria") loadCriteria(selectedSubject);
  }, [tab, selectedSubject, loadContent, loadChapters, loadCriteria]);

  async function addContent() {
    if (!selectedSubject || !cTopic || !cTitle.trim() || !cBody.trim() || cBusy) return;
    setCBusy(true);
    try {
      const r = await fetch("/api/teacher/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: selectedSubject,
          topicName: cTopic,
          contentType: cType,
          content: cBody.trim(),
          title: cTitle.trim(),
        }),
      });
      if (r.ok) {
        setCTitle("");
        setCBody("");
        await loadContent(selectedSubject);
      }
    } catch {
      /* ignore */
    } finally {
      setCBusy(false);
    }
  }

  async function toggleContent(c: Content) {
    try {
      const r = await fetch("/api/teacher/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, visible: !c.visible }),
      });
      if (r.ok) await loadContent(selectedSubject);
    } catch {
      /* ignore */
    }
  }

  async function deleteContent(c: Content) {
    try {
      const r = await fetch(`/api/teacher/content?id=${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      if (r.ok) await loadContent(selectedSubject);
    } catch {
      /* ignore */
    }
  }

  async function saveCriterion(cr: Criterion) {
    const name = (critEdits[cr.id] ?? cr.criterion_name).trim();
    if (!name) return;
    try {
      const r = await fetch("/api/teacher/criteria", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cr.id, criterionName: name }),
      });
      if (r.ok) await loadCriteria(selectedSubject);
    } catch {
      /* ignore */
    }
  }

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const r = await fetch("/api/channels");
      if (r.ok) {
        const j = (await r.json()) as { channels: Channel[] };
        setChannels(j.channels ?? []);
      }
    } catch {
      /* keep last-known */
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "settings") loadChannels();
  }, [tab, loadChannels]);

  async function addChannel() {
    if (!newChannelName.trim() || !newChannelKeywords.trim() || channelBusy) return;
    setChannelBusy(true);
    setChannelError("");
    try {
      const r = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: newChannelName.trim(),
          channelKeywords: newChannelKeywords.trim(),
        }),
      });
      if (r.status === 403) {
        setChannelError("Only grade teachers can change channels.");
      } else if (r.ok) {
        setNewChannelName("");
        setNewChannelKeywords("");
        await loadChannels();
      }
    } catch {
      /* ignore */
    } finally {
      setChannelBusy(false);
    }
  }

  async function deleteChannel(c: Channel) {
    setChannelError("");
    try {
      const r = await fetch(`/api/channels?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      if (r.status === 403) {
        setChannelError("Only grade teachers can change channels.");
      } else if (r.ok) {
        await loadChannels();
      }
    } catch {
      /* ignore */
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  const navBtn = (key: TabKey): React.CSSProperties => ({
    width: 52,
    height: 52,
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontSize: 20,
    background: tab === key ? PRIMARY : "transparent",
    color: tab === key ? "#fff" : MUTED,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  // Stats row (My Students tab) — derived entirely from data already loaded above.
  const allGrades = students.flatMap((s) => Object.values(s.grades));
  const avgGrade = allGrades.length ? allGrades.reduce((a, b) => a + b, 0) / allGrades.length : 0;
  const activeFlagCount = flags.filter((f) => !f.resolved).length;
  // ponytail: `syllabus` is keyed by verbose subject name while assigned `subjects` are the
  // short values used elsewhere (see loadTopics comment above), so this is a best-effort
  // match for a dashboard stat, not an authoritative count.
  const topicsCovered = subjects.reduce((sum, subjName) => {
    const match = syllabus.find(
      (sub) => sub.name === subjName || sub.name.toLowerCase().includes(subjName.toLowerCase())
    );
    return sum + (match?.topics.length ?? 0);
  }, 0);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: BG,
        color: DARK,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* ---- SIDEBAR ---- */}
      <aside
        style={{
          width: 88,
          flex: "0 0 88px",
          background: DARK,
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
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            background: "linear-gradient(150deg,#6B62F5,#4C43D9)",
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
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} title={t.label} style={navBtn(t.key)}>
            {t.icon}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {selectedSubject && (
          <div
            title={selectedSubject}
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              background: "#3A362E",
              borderRadius: 10,
              padding: "6px 4px",
              textAlign: "center",
              maxWidth: 64,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedSubject}
          </div>
        )}
        <button
          onClick={logout}
          title="Log out"
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            background: "transparent",
            color: MUTED,
            marginTop: 4,
          }}
        >
          ⏻
        </button>
      </aside>

      {/* ---- MAIN ---- */}
      <main style={{ flex: 1, minWidth: 0, padding: 32, overflowY: "auto", height: "100vh" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, color: DARK }}>
            {TABS.find((t) => t.key === tab)?.label}
          </div>
          <div style={{ fontSize: 13, color: MUTED }}>{user.name}</div>
        </div>

        {tab !== "students" && tab !== "settings" && tab !== "wall" && (
          <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#5A5348", fontWeight: 700 }}>Subject:</label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              style={inputStyle}
            >
              {subjects.length === 0 && <option value="">No assigned subjects</option>}
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ---- MY STUDENTS ---- */}
        {tab === "students" && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 16,
                marginBottom: 24,
              }}
            >
              {[
                { label: "Total Students", value: String(students.length), color: PRIMARY },
                { label: "Active Flags", value: String(activeFlagCount), color: WARNING },
                {
                  label: "Avg IB Grade",
                  value: allGrades.length ? avgGrade.toFixed(1) : "–",
                  color: allGrades.length ? gradeColor(avgGrade) : MUTED,
                },
                { label: "Topics Covered", value: String(topicsCovered), color: SUCCESS },
              ].map((s) => (
                <div key={s.label} style={card}>
                  <div style={{ fontSize: 12, color: MUTED, fontWeight: 700, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, color: s.color }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {loadingStudents ? (
              <div style={{ color: MUTED, padding: 24 }}>Loading students…</div>
            ) : students.length === 0 ? (
              <div style={{ ...card, textAlign: "center", color: MUTED }}>
                No students linked to the school yet.
              </div>
            ) : (
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#FBFAF7", borderBottom: `1px solid ${BORDER}` }}>
                        {["Student", "Last Active", "IB Grade", "A", "B", "C", "D", "Flags", "Actions"].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                padding: "10px 12px",
                                color: "#5A5348",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {students.flatMap((s) => {
                        const isOpen = drillStudent?.id === s.id;
                        const studentGrades = Object.values(s.grades);
                        const overall = studentGrades.length
                          ? studentGrades.reduce((a, b) => a + b, 0) / studentGrades.length
                          : null;
                        const studentFlagCount = flags.filter((f) => f.user_id === s.id).length;

                        const rows: React.ReactNode[] = [
                          <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                            <td style={{ padding: "10px 12px", fontWeight: 700 }}>{s.name}</td>
                            <td style={{ padding: "10px 12px", color: MUTED }}>–</td>
                            <td style={{ padding: "10px 12px" }}>
                              {overall === null ? (
                                <span style={{ color: MUTED }}>–</span>
                              ) : (
                                <span
                                  style={{
                                    fontWeight: 800,
                                    color: "#fff",
                                    background: gradeColor(overall),
                                    borderRadius: 6,
                                    padding: "1px 8px",
                                  }}
                                >
                                  {overall.toFixed(1)}
                                </span>
                              )}
                            </td>
                            {["A", "B", "C", "D"].map((k) => (
                              <td key={k} style={{ padding: "10px 12px", color: MUTED }}>
                                –
                              </td>
                            ))}
                            <td style={{ padding: "10px 12px" }}>
                              {studentFlagCount > 0 ? (
                                <span
                                  style={{
                                    fontWeight: 800,
                                    color: "#fff",
                                    background: WARNING,
                                    borderRadius: 10,
                                    padding: "1px 8px",
                                    fontSize: 12,
                                  }}
                                >
                                  {studentFlagCount}
                                </span>
                              ) : (
                                <span style={{ color: MUTED }}>–</span>
                              )}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {subjects.length === 0 && (
                                  <span style={{ fontSize: 12, color: MUTED }}>No subjects</span>
                                )}
                                {subjects.map((subj) => (
                                  <button
                                    key={subj}
                                    onClick={() => openDrill(s, subj)}
                                    style={{
                                      border: `1px solid ${BORDER}`,
                                      background: isOpen && drillSubject === subj ? "#EFEAFB" : "#FBFAF7",
                                      borderRadius: 10,
                                      padding: "5px 9px",
                                      cursor: "pointer",
                                      fontSize: 11,
                                      fontFamily: "inherit",
                                      color: "#5A5348",
                                    }}
                                  >
                                    {subj} · {s.grades[subj] ?? "–"}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>,
                        ];

                        if (isOpen) {
                          rows.push(
                            <tr key={`${s.id}-detail`}>
                              <td
                                colSpan={9}
                                style={{ padding: 0, borderBottom: `1px solid ${BORDER}`, background: "#FBFAF7" }}
                              >
                                <div style={{ padding: 16 }}>
                                  <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                                    <div style={{ fontWeight: 800, fontFamily: DISPLAY }}>
                                      {s.name} · {drillSubject}
                                    </div>
                                    <button
                                      onClick={() => setDrillStudent(null)}
                                      style={{ ...btn(MUTED), marginLeft: "auto" }}
                                    >
                                      Close
                                    </button>
                                  </div>

                                  {loadingDrill ? (
                                    <div style={{ color: MUTED, padding: 8 }}>Loading…</div>
                                  ) : assessments.length === 0 ? (
                                    <div style={{ color: MUTED, padding: 8 }}>
                                      No assessments yet for this subject.
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                      {assessments.map((a) => {
                                        const mastery = Math.round((a.raw_score / 8) * 100);
                                        return (
                                          <div
                                            key={a.id}
                                            style={{
                                              background: CARD,
                                              border: `1px solid ${BORDER}`,
                                              borderRadius: 14,
                                              padding: 10,
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 8,
                                            }}
                                          >
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                              <span style={{ fontWeight: 800, color: PRIMARY }}>
                                                {a.criterion}
                                              </span>
                                              <span style={{ fontSize: 13 }}>{a.criterion_name ?? ""}</span>
                                              <span style={{ marginLeft: "auto", fontSize: 12, color: MUTED }}>
                                                {a.topic_name}
                                              </span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                              <span style={{ fontSize: 11, color: MUTED, width: 76 }}>
                                                Mastery {mastery}%
                                              </span>
                                              <div
                                                style={{
                                                  flex: 1,
                                                  height: 6,
                                                  borderRadius: 4,
                                                  background: BORDER,
                                                  overflow: "hidden",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    width: `${mastery}%`,
                                                    height: "100%",
                                                    background: gradeColor(a.overall_1_7),
                                                  }}
                                                />
                                              </div>
                                              <span style={{ fontSize: 11, color: MUTED }}>IB {a.overall_1_7}</span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{ fontSize: 12, color: "#5A5348" }}>Score (0–8):</span>
                                              <input
                                                type="number"
                                                min={0}
                                                max={8}
                                                defaultValue={a.raw_score}
                                                onBlur={(e) => {
                                                  const v = parseInt(e.target.value, 10);
                                                  if (!Number.isNaN(v) && v !== a.raw_score) saveScore(a, v);
                                                }}
                                                style={{ ...inputStyle, width: 64 }}
                                              />
                                              {a.confirmed && (
                                                <span style={{ fontSize: 11, color: SUCCESS, fontWeight: 700 }}>
                                                  confirmed
                                                </span>
                                              )}
                                              <button
                                                onClick={() => saveScore(a, a.raw_score)}
                                                style={{ ...btn(SUCCESS), padding: "6px 10px" }}
                                              >
                                                Confirm
                                              </button>
                                              <button
                                                onClick={() =>
                                                  setFlagModal({ topicId: a.topic_id, topicName: a.topic_name })
                                                }
                                                style={{ ...btn(WARNING), padding: "6px 10px", marginLeft: "auto" }}
                                              >
                                                Flag for revision
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- TOPIC CONTENT ---- */}
        {tab === "content" && (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <div style={{ ...card, flex: "0 0 40%", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontWeight: 700, fontFamily: DISPLAY }}>Add content</div>
              <div style={{ fontSize: 13, color: "#6B6459" }}>Subject: <strong>{selectedSubject || "—"}</strong></div>
              <select value={cFileId} onChange={(e) => { setCFileId(e.target.value); setCTopic(""); }} style={inputStyle}>
                <option value="">Select chapter…</option>
                {chapters.map((f) => (
                  <option key={f.fileId} value={f.fileId}>{f.fileName}</option>
                ))}
              </select>
              <select value={cTopic} onChange={(e) => setCTopic(e.target.value)} style={inputStyle} disabled={!cFileId}>
                <option value="">Select topic…</option>
                {(chapters.find((f) => f.fileId === cFileId)?.topics ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={cTitle}
                onChange={(e) => setCTitle(e.target.value)}
                placeholder="Title"
                style={inputStyle}
              />
              <select value={cType} onChange={(e) => setCType(e.target.value)} style={inputStyle}>
                <option value="text">Text</option>
                <option value="image">Image URL</option>
                <option value="video">Video URL</option>
              </select>
              <textarea
                value={cBody}
                onChange={(e) => setCBody(e.target.value)}
                placeholder={cType === "text" ? "Body text" : "URL"}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <button
                onClick={addContent}
                disabled={cBusy || !selectedSubject || !cTopic || !cTitle.trim() || !cBody.trim()}
                style={{ ...btn(PRIMARY), alignSelf: "flex-start", opacity: cBusy ? 0.6 : 1 }}
              >
                {cBusy ? "Adding…" : "Add content"}
              </button>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {content.length === 0 ? (
                <div style={{ ...card, textAlign: "center", color: MUTED }}>
                  No content for this subject yet.
                </div>
              ) : (
                content.map((c) => (
                  <div key={c.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          color: "#fff",
                          background: PRIMARY,
                          borderRadius: 6,
                          padding: "2px 8px",
                        }}
                      >
                        {c.content_type}
                      </span>
                      <div style={{ fontWeight: 700 }}>{c.title}</div>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED }}>{c.topic_name}</div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#5A5348",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.content}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => toggleContent(c)} style={btn(c.visible ? SUCCESS : MUTED)}>
                        {c.visible ? "Visible" : "Hidden"}
                      </button>
                      <button onClick={() => deleteContent(c)} style={btn(DANGER)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- MYP CRITERIA ---- */}
        {tab === "criteria" && (
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {criteria.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: MUTED }}>
                No criteria configured for this subject.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#FBFAF7", borderBottom: `1px solid ${BORDER}` }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#5A5348", fontWeight: 700 }}>
                      Criterion
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#5A5348", fontWeight: 700 }}>
                      Name
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#5A5348", fontWeight: 700 }}>
                      Max Score
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#5A5348", fontWeight: 700 }} />
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((cr) => (
                    <tr key={cr.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            fontWeight: 800,
                            color: "#fff",
                            background: PRIMARY,
                            borderRadius: 8,
                            padding: "4px 12px",
                          }}
                        >
                          {cr.criterion}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <input
                          value={critEdits[cr.id] ?? cr.criterion_name}
                          onChange={(e) => setCritEdits((p) => ({ ...p, [cr.id]: e.target.value }))}
                          style={{ ...inputStyle, width: "100%" }}
                        />
                      </td>
                      <td style={{ padding: "10px 12px", color: MUTED }}>{cr.max_score}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <button onClick={() => saveCriterion(cr)} style={btn(SUCCESS)}>
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ---- WALL ---- */}
        {tab === "wall" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                style={inputStyle}
              >
                {subjects.length === 0 && <option value="">No assigned subjects</option>}
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Wall role="subject_teacher" subjectContext={selectedSubject} />
            </div>
          </div>
        )}

        {/* ---- SETTINGS (allowed video channels) ---- */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontWeight: 700, fontFamily: DISPLAY }}>Add allowed channel</div>
              <input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="Channel name"
                style={inputStyle}
              />
              <input
                value={newChannelKeywords}
                onChange={(e) => setNewChannelKeywords(e.target.value)}
                placeholder="Keywords (comma separated)"
                style={inputStyle}
              />
              <button
                onClick={addChannel}
                disabled={channelBusy || !newChannelName.trim() || !newChannelKeywords.trim()}
                style={{ ...btn(PRIMARY), alignSelf: "flex-start", opacity: channelBusy ? 0.6 : 1 }}
              >
                {channelBusy ? "Adding…" : "Add channel"}
              </button>
              {channelError && <div style={{ fontSize: 12, color: DANGER }}>{channelError}</div>}
            </div>

            {loadingChannels ? (
              <div style={{ color: MUTED, padding: 24 }}>Loading channels…</div>
            ) : channels.length === 0 ? (
              <div style={{ ...card, textAlign: "center", color: MUTED }}>
                No allowed channels configured yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {channels.map((c) => (
                  <div key={c.id} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                    {c.added_by === null && (
                      <span title="Default channel — cannot be removed" style={{ fontSize: 16 }}>
                        🔒
                      </span>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{c.channel_name}</div>
                      <div style={{ fontSize: 12, color: MUTED }}>{c.channel_keywords}</div>
                    </div>
                    {c.added_by !== null && (
                      <button onClick={() => deleteChannel(c)} style={btn(DANGER)}>
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ---- FLAG MODAL ---- */}
      {flagModal && (
        <div
          onClick={() => setFlagModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...card, width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ fontWeight: 800, fontFamily: DISPLAY }}>
              Flag “{flagModal.topicName}” for revision
            </div>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason / note for the student…"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setFlagModal(null)} style={btn(MUTED)}>
                Cancel
              </button>
              <button
                onClick={submitFlag}
                disabled={!flagReason.trim()}
                style={{ ...btn(WARNING), opacity: flagReason.trim() ? 1 : 0.6 }}
              >
                Send flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
