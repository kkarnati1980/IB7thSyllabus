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

type TabKey = "students" | "content" | "criteria" | "wall";

const card: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
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
  borderRadius: 10,
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

  // Content tab
  const [content, setContent] = useState<Content[]>([]);
  const [cTopic, setCTopic] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cType, setCType] = useState("text");
  const [cBody, setCBody] = useState("");
  const [cBusy, setCBusy] = useState(false);

  // Criteria tab
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [critEdits, setCritEdits] = useState<Record<string, string>>({});

  const topicsForSubject = useCallback(
    (name: string): Topic[] => syllabus.find((s) => s.name === name)?.topics ?? [],
    [syllabus]
  );

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

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

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
    if (tab === "content") loadContent(selectedSubject);
    if (tab === "criteria") loadCriteria(selectedSubject);
  }, [tab, selectedSubject, loadContent, loadCriteria]);

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "students", label: "My Students" },
    { key: "content", label: "Topic Content" },
    { key: "criteria", label: "MYP Criteria" },
    { key: "wall", label: "Wall" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#23201B", fontFamily: "system-ui, sans-serif" }}>
      <header
        style={{
          background: CARD,
          borderBottom: `1px solid ${BORDER}`,
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, color: PRIMARY }}>
            Subject Teacher
          </div>
          <div style={{ fontSize: 12, color: "#8A8172" }}>{user.name}</div>
        </div>
        <button onClick={logout} style={{ ...btn("#8A8172"), marginLeft: "auto" }}>
          Log out
        </button>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...btn(tab === t.key ? PRIMARY : "#fff"),
                color: tab === t.key ? "#fff" : "#5A5348",
                border: tab === t.key ? "none" : `1px solid ${BORDER}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== "students" && (
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
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
            {loadingStudents ? (
              <div style={{ color: "#8A8172", padding: 24 }}>Loading students…</div>
            ) : students.length === 0 ? (
              <div style={{ ...card, textAlign: "center", color: "#8A8172" }}>
                No students linked to the school yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {students.map((s) => (
                  <div key={s.id} style={card}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{s.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {subjects.length === 0 && (
                        <span style={{ fontSize: 12, color: "#8A8172" }}>No assigned subjects.</span>
                      )}
                      {subjects.map((subj) => (
                        <button
                          key={subj}
                          onClick={() => openDrill(s, subj)}
                          style={{
                            border: `1px solid ${BORDER}`,
                            background: "#FBFAF7",
                            borderRadius: 10,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontFamily: "inherit",
                          }}
                        >
                          <span style={{ color: "#5A5348" }}>{subj}</span>
                          <span
                            style={{
                              fontWeight: 800,
                              color: "#fff",
                              background: gradeColor(s.grades[subj] ?? 1),
                              borderRadius: 6,
                              padding: "1px 7px",
                            }}
                          >
                            {s.grades[subj] ?? "–"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- TOPIC CONTENT ---- */}
        {tab === "content" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontWeight: 700, fontFamily: DISPLAY }}>Add content</div>
              <select value={cTopic} onChange={(e) => setCTopic(e.target.value)} style={inputStyle}>
                <option value="">Select topic…</option>
                {topicsForSubject(selectedSubject).map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
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

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {content.length === 0 ? (
                <div style={{ ...card, textAlign: "center", color: "#8A8172" }}>
                  No content for this subject yet.
                </div>
              ) : (
                content.map((c) => (
                  <div key={c.id} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{c.title}</div>
                      <div style={{ fontSize: 12, color: "#8A8172" }}>
                        {c.topic_name} · {c.content_type}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleContent(c)}
                      style={{ ...btn(c.visible ? SUCCESS : "#8A8172") }}
                    >
                      {c.visible ? "Visible" : "Hidden"}
                    </button>
                    <button onClick={() => deleteContent(c)} style={btn(DANGER)}>
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- MYP CRITERIA ---- */}
        {tab === "criteria" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {criteria.length === 0 ? (
              <div style={{ ...card, textAlign: "center", color: "#8A8172" }}>
                No criteria configured for this subject.
              </div>
            ) : (
              criteria.map((cr) => (
                <div key={cr.id} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
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
                  <input
                    value={critEdits[cr.id] ?? cr.criterion_name}
                    onChange={(e) => setCritEdits((p) => ({ ...p, [cr.id]: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={() => saveCriterion(cr)} style={btn(SUCCESS)}>
                    Save
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ---- WALL ---- */}
        {tab === "wall" && <Wall role="subject_teacher" subjectContext={selectedSubject} />}
      </div>

      {/* ---- DRILL MODAL ---- */}
      {drillStudent && (
        <div
          onClick={() => setDrillStudent(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...card, width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontFamily: DISPLAY, fontSize: 18 }}>
                  {drillStudent.name}
                </div>
                <div style={{ fontSize: 12, color: "#8A8172" }}>{drillSubject}</div>
              </div>
              <button
                onClick={() => setDrillStudent(null)}
                style={{ ...btn("#8A8172"), marginLeft: "auto" }}
              >
                Close
              </button>
            </div>

            {loadingDrill ? (
              <div style={{ color: "#8A8172", padding: 16 }}>Loading…</div>
            ) : assessments.length === 0 ? (
              <div style={{ color: "#8A8172", padding: 16 }}>No assessments yet for this subject.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {assessments.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      border: `1px solid ${BORDER}`,
                      borderRadius: 10,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, color: PRIMARY }}>{a.criterion}</span>
                      <span style={{ fontSize: 13 }}>{a.criterion_name ?? ""}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A8172" }}>
                        {a.topic_name}
                      </span>
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
                        <span style={{ fontSize: 11, color: SUCCESS, fontWeight: 700 }}>confirmed</span>
                      )}
                      <button
                        onClick={() => saveScore(a, a.raw_score)}
                        style={{ ...btn(SUCCESS), padding: "6px 10px" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setFlagModal({ topicId: a.topic_id, topicName: a.topic_name })}
                        style={{ ...btn(WARNING), padding: "6px 10px", marginLeft: "auto" }}
                      >
                        Flag for revision
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
              <button onClick={() => setFlagModal(null)} style={btn("#8A8172")}>
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
