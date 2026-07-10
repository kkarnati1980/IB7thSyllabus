"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Flashcard,
  MindMap,
  ProgressEntry,
  QuizItem,
  Scaffold,
  Subject,
  SyllabusFile,
  ChatMessage,
} from "@/lib/types";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

type Screen = "home" | "library" | "tracker" | "lesson";
type Tab = "canvas" | "quiz" | "flashcards" | "videos" | "mindmap";

type Tracker = Record<string, ProgressEntry>;

function ring(pct: number, r: number) {
  const c = 2 * Math.PI * r;
  return { circ: c.toFixed(1), off: (c * (1 - pct / 100)).toFixed(1) };
}

export default function StudentApp({
  user,
  initialSubjects,
  initialProgress,
  initialChunkCount,
}: {
  user: { id: string; name: string; email: string; role: string };
  initialSubjects: Subject[];
  initialProgress: ProgressEntry[];
  initialChunkCount: number;
}) {
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);
  const [tracker, setTracker] = useState<Tracker>(() => {
    const t: Tracker = {};
    for (const p of initialProgress) t[p.topicId] = p;
    return t;
  });
  const [chunkCount, setChunkCount] = useState(initialChunkCount);
  const [files, setFiles] = useState<SyllabusFile[]>([]);

  const [screen, setScreen] = useState<Screen>("home");
  const [muted, setMuted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [driveLink, setDriveLink] = useState("");

  // lesson state
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [activeTopic, setActiveTopic] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scaffold, setScaffold] = useState<Scaffold>({});
  const [stageIndex, setStageIndex] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lessonTab, setLessonTab] = useState<Tab>("canvas");
  const queueRef = useRef<string[]>([]);

  // study tools
  const [quizData, setQuizData] = useState<QuizItem[]>([]);
  const [quizState, setQuizState] = useState<Record<number, { answer: string; correct: boolean }>>({});
  const [quizLoading, setQuizLoading] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcLoading, setFcLoading] = useState(false);
  const [videos, setVideos] = useState<import("@/lib/types").VideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [mindMap, setMindMap] = useState<MindMap | null>(null);
  const [mindMapLoading, setMindMapLoading] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
  // Refs mirroring state for use inside speech callbacks / async flows.
  const mutedRef = useRef(muted);
  const listeningRef = useRef(listening);
  const thinkingRef = useRef(thinking);
  useEffect(() => void (mutedRef.current = muted), [muted]);
  useEffect(() => void (listeningRef.current = listening), [listening]);
  useEffect(() => void (thinkingRef.current = thinking), [thinking]);

  const scrollChat = useCallback(() => {
    requestAnimationFrame(() => {
      const el = chatRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // ------------------------------------------------------------------ voice
  const speak = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    if (listeningRef.current) return; // never talk over the kid
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`>]/g, ""));
    u.rate = 1.02;
    u.pitch = 1.0;
    const vs = window.speechSynthesis.getVoices();
    const pref =
      vs.find((v) => /(daniel|google uk|arthur|male)/i.test(v.name)) ||
      vs.find((v) => /en/i.test(v.lang));
    if (pref) u.voice = pref;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  const send = useCallback(
    async (text: string, isKick = false) => {
      const msg = (text || "").trim();
      if (!msg) return;
      // Queue messages sent while Jarvis is thinking (don't drop them).
      if (thinkingRef.current && !isKick) {
        queueRef.current.push(msg);
        setChatInput("");
        return;
      }

      const history = messages.slice();
      if (!isKick) history.push({ role: "user", text: msg });
      setMessages(history);
      setChatInput("");
      setThinking(true);
      setListening(false);
      scrollChat();

      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [isKick ? "kick" : "userText"]: msg,
            history: messages,
            scaffold,
            topic: activeTopic,
            subject: activeSubject
              ? { name: activeSubject.name, icon: activeSubject.icon, color: activeSubject.color }
              : undefined,
          }),
        });
        if (!res.ok) throw new Error("tutor failed");
        const data = (await res.json()) as {
          say: string;
          stage?: number;
          scaffold: Scaffold;
          masteryDelta?: number;
        };
        const say = data.say || "Let's keep going — tell me more about what you're thinking.";
        setMessages((m) => [...m, { role: "jarvis", text: say }]);
        setScaffold(data.scaffold || {});
        if (typeof data.stage === "number") setStageIndex(data.stage);
        if (activeTopic && data.masteryDelta) {
          applyLocalDelta(activeTopic, activeSubject, data.masteryDelta);
        }
        setThinking(false);
        scrollChat();
        if (!listeningRef.current) speak(say);
        // drain queue
        const q = queueRef.current;
        if (q.length) {
          const next = q.shift()!;
          setTimeout(() => send(next), 50);
        }
      } catch {
        setMessages((m) => [
          ...m,
          { role: "jarvis", text: "I had trouble thinking just now — could you say that again?" },
        ]);
        setThinking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, scaffold, activeTopic, activeSubject, speak, scrollChat]
  );

  const sendRef = useRef(send);
  useEffect(() => void (sendRef.current = send), [send]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: SpeechRecognitionEvent) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setChatInput(t);
      if (e.results[e.results.length - 1].isFinal) {
        setListening(false);
        setTimeout(() => sendRef.current(t), 200);
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
  }, []);

  function toggleMic() {
    const r = recogRef.current;
    if (!r) {
      alert("Voice input needs Chrome/Safari with mic permission.");
      return;
    }
    if (listening) {
      r.stop();
      setListening(false);
    } else {
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      setSpeaking(false);
      try {
        r.start();
        setListening(true);
        setChatInput("");
      } catch {
        /* ignore */
      }
    }
  }
  function interruptSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
    toggleMic();
  }
  function toggleMute() {
    const m = !muted;
    if (m && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    setMuted(m);
  }

  // ------------------------------------------------------- tracker (local)
  function applyLocalDelta(
    topic: { id: string; name: string },
    subject: Subject | null,
    delta: number,
    misconceptions: string[] = []
  ) {
    setTracker((prev) => {
      const cur = prev[topic.id];
      const mastery = Math.max(0, Math.min(100, (cur?.mastery ?? 0) + delta));
      const misc = cur ? [...cur.misconceptions] : [];
      for (const x of misconceptions) if (x && !misc.includes(x)) misc.push(x);
      return {
        ...prev,
        [topic.id]: {
          topicId: topic.id,
          topicName: topic.name,
          subject: subject?.name || cur?.subject || "",
          icon: subject?.icon || cur?.icon || "📘",
          color: subject?.color || cur?.color || "#4C43D9",
          mastery,
          misconceptions: misc,
          lastSeen: Date.now(),
        },
      };
    });
  }

  function openTopic(subject: Subject, topic: { id: string; name: string }) {
    const existing = tracker[topic.id];
    setActiveSubject(subject);
    setActiveTopic(topic);
    setMessages([]);
    setScaffold({});
    setStageIndex(0);
    setChatInput("");
    setLessonTab("canvas");
    setQuizData([]);
    setQuizState({});
    setFlashcards([]);
    setVideos([]);
    setMindMap(null);
    setScreen("lesson");
    const verb = existing && existing.mastery >= 75 ? "Revise" : existing ? "Continue" : "Start";
    setTimeout(
      () =>
        sendRef.current(
          `${verb} a lesson on "${topic.name}" (${subject.name}). I'm a Grade 7 IB MYP student. Begin by discovering my goal and building the big-picture concept map.`,
          true
        ),
      30
    );
  }

  // ------------------------------------------------------------- study tools
  async function generateQuiz() {
    setQuizLoading(true);
    const res = await fetch("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }),
    });
    const j = await res.json().catch(() => ({}));
    setQuizData(Array.isArray(j.items) ? j.items : []);
    setQuizState({});
    setQuizLoading(false);
  }
  function answerQuiz(qi: number, answer: string) {
    const q = quizData[qi];
    if (!q || quizState[qi]) return;
    const correct =
      q.type === "mcq"
        ? answer === q.answer
        : answer.trim().toLowerCase().includes((q.answer || "").trim().toLowerCase().slice(0, 8));
    setQuizState((s) => ({ ...s, [qi]: { answer, correct } }));
    if (activeTopic) {
      const delta = correct ? 8 : -3;
      applyLocalDelta(activeTopic, activeSubject, delta);
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: activeTopic.id,
          topicName: activeTopic.name,
          subject: activeSubject?.name,
          icon: activeSubject?.icon,
          color: activeSubject?.color,
          masteryDelta: delta,
        }),
      });
    }
  }
  async function generateFlashcards() {
    setFcLoading(true);
    const res = await fetch("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }),
    });
    const j = await res.json().catch(() => ({}));
    setFlashcards(Array.isArray(j.items) ? j.items : []);
    setFcIndex(0);
    setFcFlipped(false);
    setFcLoading(false);
  }
  async function generateVideos() {
    setVideosLoading(true);
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }),
    });
    const j = await res.json().catch(() => ({}));
    setVideos(Array.isArray(j.items) ? j.items : []);
    setVideosLoading(false);
  }
  async function generateMindMap() {
    setMindMapLoading(true);
    const res = await fetch("/api/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }),
    });
    const j = await res.json().catch(() => ({}));
    setMindMap(j.mindMap || null);
    setMindMapLoading(false);
  }

  // --------------------------------------------------------------- library
  async function uploadFiles(fileList: File[]) {
    const md: { name: string; text: string }[] = [];
    for (const f of fileList) md.push({ name: f.name, text: await f.text() });
    if (!md.length) return;
    const res = await fetch("/api/syllabus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: md }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.files) {
      setFiles(j.files);
      setChunkCount(j.chunkCount);
      refreshSubjects();
    }
  }
  const refreshSubjects = useCallback(async () => {
    const res = await fetch("/api/me");
    if (res.ok) {
      const j = await res.json();
      if (j.subjects) setSubjects(j.subjects);
      if (j.chunkCount != null) setChunkCount(j.chunkCount);
    }
  }, []);

  useEffect(() => {
    if (screen === "library" && files.length === 0) {
      fetch("/api/syllabus")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.files) {
            setFiles(j.files);
            setChunkCount(j.chunkCount);
          }
        });
    }
  }, [screen, files.length]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  // ---------------------------------------------------------- derived data
  const dueList = useMemo(() => {
    const now = Date.now();
    return Object.values(tracker)
      .map((o) => {
        const interval = o.mastery >= 75 ? 4 : o.mastery >= 40 ? 2 : 1;
        const due = (o.lastSeen || now) + interval * 86400000;
        return { id: o.topicId, name: o.topicName, due, overdue: now >= due };
      })
      .sort((a, b) => a.due - b.due);
  }, [tracker]);

  const fmt = (d: number) => {
    const days = Math.round((d - Date.now()) / 86400000);
    return days <= 0 ? "now" : days + "d";
  };
  const findGo = (id: string) => {
    for (const s of subjects) {
      const t = s.topics.find((x) => x.id === id);
      if (t) return () => openTopic(s, t);
    }
    return () => {};
  };

  const lastKey = Object.keys(tracker).sort(
    (a, b) => (tracker[b].lastSeen || 0) - (tracker[a].lastSeen || 0)
  )[0];
  const last = lastKey ? tracker[lastKey] : null;
  const firstTopic = subjects[0]?.topics[0];

  const at = activeTopic;
  const mv = at && tracker[at.id] ? tracker[at.id].mastery : 0;
  const mr = ring(mv, 16);

  const stageDefs: [string, string][] = [
    ["🎯", "Goal"],
    ["🗺", "Big picture"],
    ["🤔", "Inquiry"],
    ["📚", "Explain"],
    ["◆", "IB lens"],
    ["⚠", "Misconceptions"],
    ["✅", "Check"],
    ["🌱", "Reinforce"],
  ];

  const layerBg = ["#ECEBFB", "#E4F3EC", "#FBE9DC", "#F3F1FB", "#23201B"];
  const layerFg = ["#372FB0", "#1E7A50", "#B5561F", "#4C43D9", "#fff"];

  const allTopics: {
    name: string;
    subject: string;
    icon: string;
    pct: number;
    color: string;
    go: () => void;
  }[] = [];
  subjects.forEach((s) =>
    s.topics.forEach((t) => {
      const tr = tracker[t.id];
      if (tr)
        allTopics.push({
          name: t.name,
          subject: s.name,
          icon: s.icon,
          pct: tr.mastery,
          color: tr.mastery >= 75 ? "#2E9E6B" : tr.mastery >= 40 ? "#E8823A" : "#C0392B",
          go: () => openTopic(s, t),
        });
    })
  );
  const misconLog: { topic: string; text: string }[] = [];
  Object.values(tracker).forEach((o) =>
    o.misconceptions.forEach((x) => misconLog.push({ topic: o.topicName, text: x }))
  );
  const schedule = dueList.map((d) => ({
    name: d.name,
    when: d.overdue ? "Due now" : "in " + fmt(d.due),
  }));

  const canvasEmpty =
    !scaffold.cm &&
    !scaffold.layers &&
    !scaffold.inquiry &&
    !scaffold.ib &&
    !scaffold.reinf &&
    !thinking &&
    messages.length <= 1;

  const navBtn = (scr: Screen): React.CSSProperties => ({
    width: 52,
    height: 52,
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontSize: 22,
    background: screen === scr ? "#4C43D9" : "transparent",
    color: screen === scr ? "#fff" : "#8A8172",
  });

  const tabSty = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "9px 4px",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    borderBottom: `3px solid ${active ? "#4C43D9" : "transparent"}`,
    background: "transparent",
    color: active ? "#4C43D9" : "#8A8172",
  });

  return (
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", background: "#EFEAE0" }}>
      {/* ===== LEFT RAIL ===== */}
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
        <button onClick={() => setScreen("home")} title="Home" style={navBtn("home")}>
          ⌂
        </button>
        <button onClick={() => setScreen("library")} title="Syllabus Library" style={navBtn("library")}>
          ▤
        </button>
        <button onClick={() => setScreen("tracker")} title="Progress Tracker" style={navBtn("tracker")}>
          ◔
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleMute}
          title="Mute voice"
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            background: muted ? "#C0392B" : "#3A362E",
            color: "#fff",
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          onClick={logout}
          title="Logout"
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            background: "transparent",
            color: "#8A8172",
            marginTop: 4,
          }}
        >
          ⏻
        </button>
      </div>

      {/* ===== MAIN ===== */}
      <div style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
        {screen === "home" && (
          <HomeScreen
            name={user.name}
            subjects={subjects}
            tracker={tracker}
            dueList={dueList}
            fmt={fmt}
            findGo={findGo}
            last={last}
            firstTopic={firstTopic}
            resumeGo={
              last
                ? findGo(lastKey)
                : firstTopic && subjects[0]
                  ? () => openTopic(subjects[0], firstTopic)
                  : () => {}
            }
            openTopic={openTopic}
            goLibrary={() => setScreen("library")}
          />
        )}

        {screen === "library" && (
          <LibraryScreen
            files={files}
            chunkCount={chunkCount}
            dragOver={dragOver}
            setDragOver={setDragOver}
            driveLink={driveLink}
            setDriveLink={setDriveLink}
            onFiles={uploadFiles}
          />
        )}

        {screen === "tracker" && (
          <TrackerScreen
            tracker={tracker}
            allTopics={allTopics}
            misconLog={misconLog}
            schedule={schedule}
            dueList={dueList}
          />
        )}

        {screen === "lesson" && activeTopic && (
          <div style={{ display: "flex", height: "100vh" }}>
            {/* conversation column */}
            <div
              style={{
                flex: "0 0 46%",
                maxWidth: 560,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid #E2DBCE",
                background: "#F6F3EC",
              }}
            >
              <div
                style={{
                  padding: "18px 24px",
                  borderBottom: "1px solid #E2DBCE",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "#fff",
                }}
              >
                <button
                  onClick={() => setScreen("home")}
                  style={{
                    background: "#F1ECE2",
                    border: "none",
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    cursor: "pointer",
                    fontSize: 16,
                  }}
                >
                  ←
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>
                    {activeTopic.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8172" }}>
                    {activeSubject?.name} · with Jarvis
                  </div>
                </div>
                <div style={{ position: "relative", width: 40, height: 40 }}>
                  <svg viewBox="0 0 40 40" style={{ width: 40, height: 40, transform: "rotate(-90deg)" }}>
                    <circle cx="20" cy="20" r="16" fill="none" stroke="#EEE9DF" strokeWidth="5" />
                    <circle
                      cx="20"
                      cy="20"
                      r="16"
                      fill="none"
                      stroke="#2E9E6B"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={mr.circ}
                      strokeDashoffset={mr.off}
                    />
                  </svg>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 11,
                    }}
                  >
                    {mv}%
                  </div>
                </div>
              </div>

              <div
                ref={chatRef}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "22px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {messages.map((m, i) => {
                  const u = m.role === "user";
                  return (
                    <div key={i} style={{ alignSelf: u ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#A79E8E",
                          marginBottom: 3,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".06em",
                          textAlign: u ? "right" : "left",
                        }}
                      >
                        {u ? "You" : "Jarvis"}
                      </div>
                      <div
                        style={{
                          background: u ? "#4C43D9" : "#fff",
                          color: u ? "#fff" : "#23201B",
                          padding: "12px 15px",
                          borderRadius: u ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                          fontSize: 15,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })}
                {thinking && (
                  <div
                    style={{
                      alignSelf: "flex-start",
                      background: "#fff",
                      border: "1px solid #E7E1D6",
                      padding: "14px 18px",
                      borderRadius: "16px 16px 16px 4px",
                      display: "flex",
                      gap: 5,
                    }}
                  >
                    {[0, 0.2, 0.4].map((d) => (
                      <span
                        key={d}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#4C43D9",
                          animation: `jdot 1.2s infinite ${d}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ padding: "16px 20px", borderTop: "1px solid #E2DBCE", background: "#fff" }}>
                {speaking && (
                  <div
                    onClick={interruptSpeech}
                    style={{
                      textAlign: "center",
                      fontSize: 13,
                      color: "#4C43D9",
                      fontWeight: 700,
                      marginBottom: 8,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    🔊 Jarvis is speaking — tap to interrupt
                  </div>
                )}
                {listening && (
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 13,
                      color: "#E8823A",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    ● Listening… speak now
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <button
                    onClick={toggleMic}
                    style={{
                      flex: "0 0 52px",
                      height: 52,
                      borderRadius: 16,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 22,
                      background: listening ? "#FBE9DC" : "#F1ECE2",
                      color: listening ? "#E8823A" : "#5A5347",
                      position: "relative",
                    }}
                  >
                    {listening && (
                      <span
                        style={{
                          position: "absolute",
                          inset: -4,
                          borderRadius: 20,
                          border: "2px solid #E8823A",
                          animation: "jpulse 1.1s infinite",
                        }}
                      />
                    )}
                    🎙
                  </button>
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(chatInput);
                      }
                    }}
                    placeholder="Ask Jarvis, or answer aloud…"
                    rows={1}
                    style={{
                      flex: 1,
                      resize: "none",
                      border: "1px solid #E0D9CC",
                      borderRadius: 14,
                      padding: "14px 15px",
                      fontSize: 15,
                      maxHeight: 120,
                    }}
                  />
                  <button
                    onClick={() => send(chatInput)}
                    style={{
                      flex: "0 0 52px",
                      height: 52,
                      borderRadius: 16,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 20,
                      background: "#4C43D9",
                      color: "#fff",
                    }}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </div>

            {/* learning canvas column */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflowY: "auto",
                padding: "0 0 60px",
                background: "#EFEAE0",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* tab bar */}
              <div
                style={{
                  display: "flex",
                  background: "#fff",
                  borderBottom: "1px solid #E7E1D6",
                  padding: "0 20px",
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}
              >
                <button onClick={() => setLessonTab("canvas")} style={tabSty(lessonTab === "canvas")}>
                  🧭 Canvas
                </button>
                <button onClick={() => setLessonTab("quiz")} style={tabSty(lessonTab === "quiz")}>
                  📝 Quiz
                </button>
                <button
                  onClick={() => setLessonTab("flashcards")}
                  style={tabSty(lessonTab === "flashcards")}
                >
                  🗂 Flashcards
                </button>
                <button onClick={() => setLessonTab("videos")} style={tabSty(lessonTab === "videos")}>
                  ▶ Videos
                </button>
                <button
                  onClick={() => setLessonTab("mindmap")}
                  style={tabSty(lessonTab === "mindmap")}
                >
                  🕸 Mind Map
                </button>
              </div>

              {lessonTab === "canvas" && (
                <CanvasTab
                  scaffold={scaffold}
                  stageIndex={stageIndex}
                  stageDefs={stageDefs}
                  layerBg={layerBg}
                  layerFg={layerFg}
                  canvasEmpty={canvasEmpty}
                />
              )}

              {lessonTab === "quiz" && (
                <QuizTab
                  quizData={quizData}
                  quizState={quizState}
                  quizLoading={quizLoading}
                  generateQuiz={generateQuiz}
                  answerQuiz={answerQuiz}
                />
              )}

              {lessonTab === "flashcards" && (
                <FlashcardsTab
                  flashcards={flashcards}
                  fcIndex={fcIndex}
                  fcFlipped={fcFlipped}
                  fcLoading={fcLoading}
                  generate={generateFlashcards}
                  flip={() => setFcFlipped((f) => !f)}
                  next={() => {
                    setFcIndex((i) => (i + 1) % flashcards.length);
                    setFcFlipped(false);
                  }}
                  prev={() => {
                    setFcIndex((i) => (i - 1 + flashcards.length) % flashcards.length);
                    setFcFlipped(false);
                  }}
                />
              )}

              {lessonTab === "videos" && (
                <VideosTab videos={videos} loading={videosLoading} generate={generateVideos} />
              )}

              {lessonTab === "mindmap" && (
                <MindMapTab mindMap={mindMap} loading={mindMapLoading} generate={generateMindMap} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================ HOME ============================ */
function HomeScreen(props: {
  name: string;
  subjects: Subject[];
  tracker: Tracker;
  dueList: { id: string; name: string; due: number; overdue: boolean }[];
  fmt: (d: number) => string;
  findGo: (id: string) => () => void;
  last: ProgressEntry | null;
  firstTopic?: { id: string; name: string };
  resumeGo: () => void;
  openTopic: (s: Subject, t: { id: string; name: string }) => void;
  goLibrary: () => void;
}) {
  const { name, subjects, tracker, dueList, fmt, last, firstTopic, resumeGo, openTopic, goLibrary } =
    props;
  const dueTopics = dueList
    .slice(0, 3)
    .map((d) => ({ name: d.name, when: d.overdue ? "due now" : fmt(d.due), id: d.id }));

  const pills: [string, string][] = [
    ["🧭", "Canvas"],
    ["📝", "Quiz"],
    ["🗂", "Flashcards"],
    ["▶", "Videos"],
    ["🕸", "Mind Map"],
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "54px 48px 80px", animation: "jfade .4s ease" }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 500,
          fontSize: 15,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "#8A8172",
        }}
      >
        IB MYP · Self-Learning Studio
      </div>
      <h1
        style={{
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 44,
          lineHeight: 1.05,
          margin: "10px 0 4px",
          letterSpacing: "-.02em",
        }}
      >
        Hi {name} 👋
      </h1>
      <p style={{ fontSize: 18, color: "#6B6459", margin: "0 0 16px", maxWidth: 620 }}>
        What would you like to understand today? Pick a topic and Jarvis will teach it the IB way —
        through inquiry, not memorising.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30, alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#8A8172", fontWeight: 600 }}>Inside each lesson:</span>
        {pills.map(([icon, label]) => (
          <span
            key={label}
            style={{
              background: "#fff",
              border: "1px solid #E7E1D6",
              padding: "5px 12px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 700,
              color: "#4C43D9",
            }}
          >
            {icon} {label}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 40 }}>
        <div
          style={{
            background: "linear-gradient(150deg,#4C43D9,#6B62F5)",
            borderRadius: 24,
            padding: "28px 30px",
            color: "#fff",
            boxShadow: "0 18px 40px -18px rgba(76,67,217,.7)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 170,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                opacity: 0.8,
                fontFamily: DISPLAY,
              }}
            >
              Continue learning
            </div>
            <div
              style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 27, marginTop: 8, lineHeight: 1.1 }}
            >
              {last ? last.topicName : firstTopic ? firstTopic.name : "Start your first lesson"}
            </div>
            <div style={{ opacity: 0.85, marginTop: 6, fontSize: 15 }}>
              {last
                ? `${last.mastery}% mastery · pick up where you left off`
                : "Choose any subject to begin"}
            </div>
          </div>
          <button
            onClick={resumeGo}
            style={{
              alignSelf: "flex-start",
              marginTop: 20,
              background: "#fff",
              color: "#4C43D9",
              border: "none",
              borderRadius: 12,
              padding: "12px 22px",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Resume with Jarvis →
          </button>
        </div>
        <div style={{ background: "#fff", borderRadius: 24, padding: 24, border: "1px solid #E7E1D6" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            <span style={{ color: "#E8823A" }}>↻</span> Revision due
          </div>
          <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 12 }}>
            Spaced repetition keeps it in long-term memory.
          </div>
          {dueTopics.map((d) => (
            <button
              key={d.id}
              onClick={props.findGo(d.id)}
              style={{
                width: "100%",
                textAlign: "left",
                background: "#FBF4EC",
                border: "1px solid #F0E2D2",
                borderRadius: 12,
                padding: "11px 13px",
                marginBottom: 8,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</span>
              <span style={{ fontSize: 11, color: "#E8823A", fontWeight: 700 }}>{d.when}</span>
            </button>
          ))}
          {dueTopics.length === 0 && (
            <div style={{ fontSize: 13, color: "#A79E8E", padding: "8px 2px" }}>
              Nothing due — you&apos;re on track. 🎉
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, margin: 0 }}>Your subjects</h2>
        <button
          onClick={goLibrary}
          style={{
            background: "none",
            border: "none",
            color: "#4C43D9",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Manage syllabus →
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: 18,
        }}
      >
        {subjects.map((s) => {
          const pctNum = s.topics.length
            ? Math.round(
                s.topics.reduce((a, t) => a + (tracker[t.id]?.mastery || 0), 0) / s.topics.length
              )
            : 0;
          const rv = ring(pctNum, 22);
          const mastered = s.topics.filter((t) => (tracker[t.id]?.mastery || 0) >= 75).length;
          return (
            <div
              key={s.id}
              style={{
                background: "#fff",
                borderRadius: 22,
                border: "1px solid #E7E1D6",
                padding: 22,
                animation: "jfade .4s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 14,
                    background: s.soft,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 23,
                  }}
                >
                  {s.icon}
                </div>
                <div style={{ position: "relative", width: 52, height: 52 }}>
                  <svg viewBox="0 0 52 52" style={{ width: 52, height: 52, transform: "rotate(-90deg)" }}>
                    <circle cx="26" cy="26" r="22" fill="none" stroke="#EEE9DF" strokeWidth="6" />
                    <circle
                      cx="26"
                      cy="26"
                      r="22"
                      fill="none"
                      stroke={s.color}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={rv.circ}
                      strokeDashoffset={rv.off}
                    />
                  </svg>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 13,
                      fontFamily: DISPLAY,
                    }}
                  >
                    {pctNum}%
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, margin: "14px 0 3px" }}>
                {s.name}
              </div>
              <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 6 }}>
                {s.topics.length} topics · {mastered} mastered
              </div>
              <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                <Pill bg="#ECEBFB" color="#4C43D9" text="📝 Quiz" />
                <Pill bg="#E4F3EC" color="#1E7A50" text="🗂 Cards" />
                <Pill bg="#FDECEA" color="#C0392B" text="▶ Videos" />
                <Pill bg="#EFE9FB" color="#7A5AC2" text="🕸 Map" />
              </div>
              {s.topics.map((t) => {
                const m = tracker[t.id]?.mastery || 0;
                const dot = m >= 75 ? "#2E9E6B" : m >= 40 ? "#E8823A" : "#CFC7B8";
                const badge = m >= 75 ? "Mastered" : m > 0 ? m + "%" : "New";
                return (
                  <button
                    key={t.id}
                    onClick={() => openTopic(s, t)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "#FAF8F3",
                      border: "1px solid #EEE9DF",
                      borderRadius: 11,
                      padding: "10px 12px",
                      marginBottom: 7,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, flex: "0 0 9px" }} />
                    <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: "#A79E8E" }}>{badge}</span>
                    <span style={{ fontSize: 13, color: "#4C43D9", fontWeight: 700 }}>→</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ bg, color, text }: { bg: string; color: string; text: string }) {
  return (
    <span
      style={{
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 20,
      }}
    >
      {text}
    </span>
  );
}

/* ============================ LIBRARY ============================ */
function LibraryScreen(props: {
  files: SyllabusFile[];
  chunkCount: number;
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  driveLink: string;
  setDriveLink: (s: string) => void;
  onFiles: (f: File[]) => void;
}) {
  const { files, chunkCount, dragOver, setDragOver, driveLink, setDriveLink, onFiles } = props;
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "54px 48px 80px", animation: "jfade .4s ease" }}>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, margin: "0 0 4px", letterSpacing: "-.02em" }}>
        Syllabus Library
      </h1>
      <p style={{ fontSize: 17, color: "#6B6459", margin: "0 0 30px", maxWidth: 600 }}>
        Jarvis grounds every explanation in <strong>your</strong> curriculum. Drop in the{" "}
        <code>.md</code> files for your units — they&apos;re indexed on the server for retrieval.
      </p>

      <div
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const fs = Array.from(e.dataTransfer.files || []).filter((f) =>
            /\.(md|markdown|txt)$/i.test(f.name)
          );
          onFiles(fs);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        style={{
          border: `2px dashed ${dragOver ? "#4C43D9" : "#CFC7B8"}`,
          background: dragOver ? "#F3F1FB" : "#fff",
          borderRadius: 22,
          padding: 40,
          textAlign: "center",
          transition: ".15s",
        }}
      >
        <div style={{ fontSize: 40 }}>📄</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, marginTop: 8 }}>
          Drag &amp; drop your .md syllabus files
        </div>
        <div style={{ color: "#8A8172", fontSize: 14, margin: "6px 0 18px" }}>
          Markdown files, chunked by heading and indexed with TF-IDF retrieval on the server.
        </div>
        <label
          style={{
            display: "inline-block",
            background: "#4C43D9",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 22px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Choose files
          <input
            type="file"
            accept=".md,.markdown,.txt"
            multiple
            onChange={(e) => onFiles(Array.from(e.target.files || []))}
            style={{ display: "none" }}
          />
        </label>
      </div>

      <div style={{ margin: "26px 0", padding: "20px 22px", background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Google Drive folder
        </div>
        <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 12 }}>
          Paste a shared Drive link. In this build, syncing falls back to file upload above.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={driveLink}
            onChange={(e) => setDriveLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            style={{
              flex: 1,
              border: "1px solid #E0D9CC",
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 14,
            }}
          />
          <button
            onClick={() =>
              alert(
                "In this build, drag your .md files into the box above — Drive sync is a follow-on server integration."
              )
            }
            style={{
              background: "#23201B",
              color: "#fff",
              border: "none",
              borderRadius: 11,
              padding: "0 20px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Connect
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "8px 0 14px" }}>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, margin: 0 }}>Indexed files</h2>
        <span style={{ fontSize: 13, color: "#8A8172" }}>{chunkCount} chunks retrievable</span>
      </div>
      {files.map((f) => (
        <div
          key={f.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "#fff",
            border: "1px solid #E7E1D6",
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>📄</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{f.name}</div>
            <div style={{ fontSize: 12, color: "#8A8172" }}>{f.count} sections indexed</div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#2E9E6B" }}>● indexed</span>
        </div>
      ))}
    </div>
  );
}

/* ============================ TRACKER ============================ */
function TrackerScreen(props: {
  tracker: Tracker;
  allTopics: { name: string; subject: string; icon: string; pct: number; color: string; go: () => void }[];
  misconLog: { topic: string; text: string }[];
  schedule: { name: string; when: string }[];
  dueList: { overdue: boolean }[];
}) {
  const { tracker, allTopics, misconLog, schedule, dueList } = props;
  const statTopics = Object.keys(tracker).length;
  const statMastered = Object.values(tracker).filter((o) => o.mastery >= 75).length;
  const statDue = dueList.filter((d) => d.overdue).length;
  const statMiscon = misconLog.length;

  const stat = (v: number, label: string, color: string) => (
    <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 18 }}>
      <div style={{ fontSize: 32, fontFamily: DISPLAY, fontWeight: 800, color }}>{v}</div>
      <div style={{ fontSize: 13, color: "#8A8172" }}>{label}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "54px 48px 80px", animation: "jfade .4s ease" }}>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, margin: "0 0 4px", letterSpacing: "-.02em" }}>
        Progress Tracker
      </h1>
      <p style={{ fontSize: 17, color: "#6B6459", margin: "0 0 30px" }}>
        Where you&apos;re strong, where to revise, and what&apos;s due next.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 32 }}>
        {stat(statTopics, "Topics started", "#4C43D9")}
        {stat(statMastered, "Mastered (75%+)", "#2E9E6B")}
        {stat(statDue, "Due for revision", "#E8823A")}
        {stat(statMiscon, "Misconceptions", "#C0392B")}
      </div>

      <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, margin: "0 0 14px" }}>Mastery by topic</h2>
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: "8px 20px", marginBottom: 30 }}>
        {allTopics.length === 0 && (
          <div style={{ fontSize: 14, color: "#A79E8E", padding: "16px 0" }}>
            Start a lesson to begin tracking mastery.
          </div>
        )}
        {allTopics.map((t, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "13px 0",
              borderBottom: "1px solid #F1ECE2",
            }}
          >
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: "#A79E8E" }}>{t.subject}</div>
            </div>
            <div style={{ width: 180, height: 9, background: "#EEE9DF", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${t.pct}%`, background: t.color, borderRadius: 6 }} />
            </div>
            <div style={{ width: 44, textAlign: "right", fontWeight: 700, fontSize: 14, color: t.color }}>
              {t.pct}%
            </div>
            <button
              onClick={t.go}
              style={{
                background: "#F3F1FB",
                color: "#4C43D9",
                border: "none",
                borderRadius: 9,
                padding: "7px 12px",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Revise
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 12, color: "#C0392B" }}>
            ⚠ Misconceptions to fix
          </div>
          {misconLog.map((m, i) => (
            <div key={i} style={{ fontSize: 14, padding: "9px 0", borderBottom: "1px solid #F1ECE2" }}>
              <strong>{m.topic}:</strong> {m.text}
            </div>
          ))}
          {misconLog.length === 0 && (
            <div style={{ fontSize: 13, color: "#A79E8E" }}>None logged yet.</div>
          )}
        </div>
        <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 12, color: "#E8823A" }}>
            ↻ Spaced-repetition schedule
          </div>
          {schedule.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 14,
                padding: "9px 0",
                borderBottom: "1px solid #F1ECE2",
              }}
            >
              <span>{s.name}</span>
              <span style={{ color: "#E8823A", fontWeight: 700 }}>{s.when}</span>
            </div>
          ))}
          {schedule.length === 0 && (
            <div style={{ fontSize: 13, color: "#A79E8E" }}>Nothing scheduled yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ CANVAS TAB ============================ */
function CanvasTab({
  scaffold,
  stageIndex,
  stageDefs,
  layerBg,
  layerFg,
  canvasEmpty,
}: {
  scaffold: Scaffold;
  stageIndex: number;
  stageDefs: [string, string][];
  layerBg: string[];
  layerFg: string[];
  canvasEmpty: boolean;
}) {
  const cm = scaffold.cm;
  const ib = scaffold.ib;
  const chip = (bg: string, color: string) => (v: string, i: number) => (
    <span
      key={i}
      style={{ background: bg, color, padding: "5px 11px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}
    >
      {v}
    </span>
  );
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {stageDefs.map((d, i) => {
          const done = i < stageIndex;
          const cur = i === stageIndex;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: cur ? "#4C43D9" : done ? "#E4F3EC" : "#fff",
                color: cur ? "#fff" : done ? "#1E7A50" : "#A79E8E",
                border: `1px solid ${cur ? "#4C43D9" : done ? "#BEE3CF" : "#E7E1D6"}`,
                padding: "7px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span>{d[0]}</span>
              {d[1]}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#8A8172",
          marginBottom: 14,
        }}
      >
        Learning canvas
      </div>

      {cm && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
            🗺 The Big Picture
          </div>
          <div
            style={{
              textAlign: "center",
              background: "linear-gradient(150deg,#4C43D9,#6B62F5)",
              color: "#fff",
              borderRadius: 16,
              padding: 16,
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 18,
              margin: "12px 0 18px",
            }}
          >
            {cm.core}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <CmGroup title="Key concepts" titleColor="#4C43D9">
              {cm.keyConcepts.map(chip("#ECEBFB", "#372FB0"))}
            </CmGroup>
            <CmGroup title="Related concepts" titleColor="#E8823A">
              {cm.related.map(chip("#FBE9DC", "#B5561F"))}
            </CmGroup>
            <CmGroup title="Vocabulary" titleColor="#6B6459">
              {cm.vocab.map(chip("#F1ECE2", "#5A5347"))}
            </CmGroup>
            <CmGroup title="Real-world links" titleColor="#2E9E6B">
              {cm.applications.map(chip("#E4F3EC", "#1E7A50"))}
            </CmGroup>
          </div>
        </Card>
      )}

      {scaffold.inquiry && scaffold.inquiry.length > 0 && (
        <div
          style={{
            background: "#FBF4EC",
            border: "1px solid #F0E2D2",
            borderRadius: 20,
            padding: 22,
            marginBottom: 16,
            animation: "jfade .4s ease",
          }}
        >
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 12 }}>🤔 Think first</div>
          {scaffold.inquiry.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 15, lineHeight: 1.45 }}>
              <span style={{ color: "#E8823A", fontWeight: 800 }}>?</span>
              {q}
            </div>
          ))}
        </div>
      )}

      {scaffold.layers && scaffold.layers.length > 0 && (
        <Card>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 14 }}>📚 Explained in layers</div>
          {scaffold.layers.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div
                style={{
                  flex: "0 0 34px",
                  height: 34,
                  borderRadius: 10,
                  background: layerBg[(l.level - 1) % 5] || "#ECEBFB",
                  color: layerFg[(l.level - 1) % 5] || "#372FB0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontFamily: DISPLAY,
                }}
              >
                {l.level}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{l.title}</div>
                <div style={{ fontSize: 14, color: "#4A453C", lineHeight: 1.5 }}>{l.text}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {ib && (
        <div style={{ background: "#23201B", color: "#fff", borderRadius: 20, padding: 24, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 16 }}>◆ IB conceptual lens</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <IbCell label="Key concept" value={ib.key} color="#9B93FF" />
            <IbCell label="Related concept" value={ib.related} color="#F5A66B" />
            <IbCell label="Global context" value={ib.global} color="#6FD69C" />
            <div style={{ gridColumn: "1 / 3" }}>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Statement of inquiry
              </div>
              <div style={{ fontSize: 15, marginTop: 3, lineHeight: 1.45, fontStyle: "italic" }}>
                &quot;{ib.soi}&quot;
              </div>
            </div>
          </div>
          {ib.atl && ib.atl.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.15)" }}>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
                ATL skills you&apos;re using
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ib.atl.map((a, i) => (
                  <span key={i} style={{ background: "rgba(255,255,255,.12)", padding: "5px 11px", borderRadius: 20, fontSize: 13 }}>
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {scaffold.miscon && scaffold.miscon.length > 0 && (
        <div style={{ background: "#FDF0EE", border: "1px solid #F5D5CF", borderRadius: 20, padding: 22, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 12, color: "#C0392B" }}>
            ⚠ Watch out for this
          </div>
          {scaffold.miscon.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Many think: &quot;{m.think}&quot;</div>
              <div style={{ fontSize: 14, color: "#4A453C", lineHeight: 1.5, marginTop: 3 }}>{m.why}</div>
            </div>
          ))}
        </div>
      )}

      {scaffold.checkpoint && (
        <div style={{ background: "linear-gradient(150deg,#2E9E6B,#38B87C)", color: "#fff", borderRadius: 20, padding: 24, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
            Mastery checkpoint · Level {scaffold.checkpoint.level}
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, margin: "8px 0 6px", lineHeight: 1.25 }}>
            {scaffold.checkpoint.question}
          </div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            Answer by voice 🎙 or type — Jarvis will check your thinking.
          </div>
        </div>
      )}

      {scaffold.reinf && (
        <Card>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 14 }}>✅ Lock it in</div>
          <div style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 12 }}>{scaffold.reinf.summary}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <ReinfCell bg="#E4F3EC" color="#1E7A50" label="Real-world use" text={scaffold.reinf.application} />
            <ReinfCell bg="#ECEBFB" color="#372FB0" label="Challenge" text={scaffold.reinf.challenge} />
            <ReinfCell bg="#FBE9DC" color="#B5561F" label="Memory trick" text={scaffold.reinf.trick} />
            <ReinfCell bg="#FBF4EC" color="#8A6D2F" label="Revision tip" text={scaffold.reinf.tip} />
          </div>
        </Card>
      )}

      {scaffold.reflection && scaffold.reflection.length > 0 && (
        <div style={{ background: "#F3F1FB", border: "1px solid #DEDAF5", borderRadius: 20, padding: 22, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 12, color: "#4C43D9" }}>🌱 Reflect</div>
          {scaffold.reflection.map((r, i) => (
            <div key={i} style={{ fontSize: 15, marginBottom: 9, lineHeight: 1.45 }}>
              {r}
            </div>
          ))}
        </div>
      )}

      {canvasEmpty && (
        <div style={{ textAlign: "center", color: "#A79E8E", padding: "60px 20px" }}>
          <div style={{ fontSize: 44 }}>🧭</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, marginTop: 10, color: "#6B6459" }}>
            Your learning canvas fills in as Jarvis teaches.
          </div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            Say hello, or tell Jarvis what you&apos;d like to learn.
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E7E1D6",
        borderRadius: 20,
        padding: 24,
        marginBottom: 16,
        animation: "jfade .4s ease",
      }}
    >
      {children}
    </div>
  );
}
function CmGroup({ title, titleColor, children }: { title: string; titleColor: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color: titleColor, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>
    </div>
  );
}
function IbCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 3, color }}>{value}</div>
    </div>
  );
}
function ReinfCell({ bg, color, label, text }: { bg: string; color: string; label: string; text: string }) {
  return (
    <div style={{ background: bg, borderRadius: 12, padding: 13 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  );
}

/* ============================ QUIZ TAB ============================ */
function QuizTab({
  quizData,
  quizState,
  quizLoading,
  generateQuiz,
  answerQuiz,
}: {
  quizData: QuizItem[];
  quizState: Record<number, { answer: string; correct: boolean }>;
  quizLoading: boolean;
  generateQuiz: () => void;
  answerQuiz: (qi: number, answer: string) => void;
}) {
  const score = Object.values(quizState).filter((x) => x.correct).length;
  const answered = Object.keys(quizState).length;
  const scoreBar = quizData.length ? Math.round((answered / quizData.length) * 100) : 0;
  const btnLabel = quizLoading ? "Generating…" : quizData.length ? "Regenerate" : "Generate Quiz";

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader
        title="Chapter Quiz"
        subtitle="IB MYP-style questions — recall, application, analysis"
        btnLabel={btnLabel}
        btnColor="#4C43D9"
        onClick={generateQuiz}
      />
      {quizData.length > 0 && (
        <>
          <div
            style={{
              background: "#fff",
              border: "1px solid #E7E1D6",
              borderRadius: 16,
              padding: "14px 20px",
              marginBottom: 18,
              display: "flex",
              gap: 20,
              alignItems: "center",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, color: "#4C43D9" }}>
                {score}/{answered}
              </div>
              <div style={{ fontSize: 12, color: "#8A8172" }}>answered correct</div>
            </div>
            <div style={{ flex: 1, height: 10, background: "#EEE9DF", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#2E9E6B", borderRadius: 6, width: `${scoreBar}%` }} />
            </div>
          </div>
          {quizData.map((q, i) => {
            const st = quizState[i];
            const isMcq = q.type === "mcq";
            const opts = q.options || [];
            return (
              <div
                key={i}
                style={{
                  background: st ? (st.correct ? "#E4F3EC" : "#FDECEA") : "#fff",
                  border: "1px solid #E7E1D6",
                  borderRadius: 18,
                  padding: 22,
                  marginBottom: 14,
                  animation: "jfade .3s ease",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                  <span
                    style={{
                      fontSize: 16,
                      color: st ? (st.correct ? "#2E9E6B" : "#C0392B") : "#8A8172",
                      fontWeight: 800,
                      minWidth: 20,
                    }}
                  >
                    {st ? (st.correct ? "✓" : "✗") : ""}
                  </span>
                  <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }}>{q.question}</div>
                </div>
                {isMcq && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {opts.map((o, oi) => (
                      <button
                        key={oi}
                        onClick={() => answerQuiz(i, o)}
                        style={{
                          background: "#F6F3EC",
                          border: "1px solid #E7E1D6",
                          borderRadius: 12,
                          padding: "11px 13px",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {st && (
                  <div style={{ marginTop: 12, padding: "12px 14px", background: "rgba(0,0,0,.04)", borderRadius: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#4C43D9" }}>
                      Correct answer: {q.answer}
                    </div>
                    <div style={{ fontSize: 13, color: "#4A453C", marginTop: 4, lineHeight: 1.5 }}>
                      {q.explanation}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {quizLoading && <Loading emoji="📝" text="Generating IB-style questions…" />}
    </div>
  );
}

/* ============================ FLASHCARDS TAB ============================ */
function FlashcardsTab({
  flashcards,
  fcIndex,
  fcFlipped,
  fcLoading,
  generate,
  flip,
  next,
  prev,
}: {
  flashcards: Flashcard[];
  fcIndex: number;
  fcFlipped: boolean;
  fcLoading: boolean;
  generate: () => void;
  flip: () => void;
  next: () => void;
  prev: () => void;
}) {
  const card = flashcards[fcIndex];
  const btnLabel = fcLoading ? "Generating…" : flashcards.length ? "Regenerate" : "Generate Flashcards";
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader
        title="Flashcards"
        subtitle="Tap to flip — key terms, definitions, IB links"
        btnLabel={btnLabel}
        btnColor="#4C43D9"
        onClick={generate}
      />
      {flashcards.length > 0 && card && (
        <>
          <div style={{ textAlign: "center", fontSize: 13, color: "#8A8172", marginBottom: 14 }}>
            Card {fcIndex + 1} of {flashcards.length}
          </div>
          <div
            onClick={flip}
            style={{
              background: "linear-gradient(150deg,#4C43D9,#6B62F5)",
              borderRadius: 28,
              minHeight: 220,
              padding: "36px 32px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              cursor: "pointer",
              boxShadow: "0 20px 50px -20px rgba(76,67,217,.6)",
              marginBottom: 18,
              animation: "jfade .3s ease",
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.7)", marginBottom: 12, fontWeight: 700 }}>
              {fcFlipped ? "Definition" : "Term"} · tap to flip
            </div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 24, color: "#fff", textAlign: "center", lineHeight: 1.3 }}>
              {fcFlipped ? card.definition : card.term}
            </div>
            {fcFlipped && (
              <>
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.25)", fontSize: 14, color: "rgba(255,255,255,.85)", textAlign: "center" }}>
                  📌 {card.example}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,.65)" }}>
                  IB link: {card.ib_link}
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={prev} style={fcNavBtn}>
              ←
            </button>
            <button
              onClick={flip}
              style={{ background: "#ECEBFB", border: "none", borderRadius: 14, padding: "12px 28px", fontWeight: 700, cursor: "pointer", color: "#4C43D9" }}
            >
              Flip
            </button>
            <button onClick={next} style={fcNavBtn}>
              →
            </button>
          </div>
        </>
      )}
      {fcLoading && <Loading emoji="🗂" text="Generating flashcards…" />}
    </div>
  );
}
const fcNavBtn: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E7E1D6",
  borderRadius: 14,
  padding: "12px 24px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 18,
};

/* ============================ VIDEOS TAB ============================ */
function VideosTab({
  videos,
  loading,
  generate,
}: {
  videos: import("@/lib/types").VideoItem[];
  loading: boolean;
  generate: () => void;
}) {
  const ytUrl = (v: import("@/lib/types").VideoItem) => {
    if (v.video_id)
      return `https://www.youtube.com/watch?v=${v.video_id}${v.timestamp_seconds ? "&t=" + v.timestamp_seconds : ""}`;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(v.search_query || v.title)}`;
  };
  const btnLabel = loading ? "Finding…" : videos.length ? "Refresh" : "Find Videos";
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader
        title="Explanatory Videos"
        subtitle="Curated YouTube resources — concept-specific, Grade 7 IB level"
        btnLabel={btnLabel}
        btnColor="#C0392B"
        onClick={generate}
      />
      {videos.length > 0 && (
        <>
          {videos.map((v, i) => {
            const channelTimestamp = [v.channel, v.timestamp_label].filter(Boolean).join(" · ⏱ ");
            return (
              <a
                key={i}
                href={ytUrl(v)}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  background: "#fff",
                  border: "1px solid #E7E1D6",
                  borderRadius: 18,
                  padding: "18px 20px",
                  marginBottom: 12,
                  textDecoration: "none",
                  animation: "jfade .3s ease",
                }}
              >
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: "#FDECEA",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      flex: "0 0 48px",
                    }}
                  >
                    ▶
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#23201B", lineHeight: 1.3 }}>{v.title}</div>
                    <div style={{ fontSize: 12, color: "#8A8172", marginTop: 2 }}>{channelTimestamp}</div>
                    <div style={{ fontSize: 13, color: "#4A453C", marginTop: 6, lineHeight: 1.45 }}>{v.reason}</div>
                    {v.concept_covered && (
                      <div
                        style={{
                          display: "inline-block",
                          marginTop: 8,
                          background: "#FBE9DC",
                          color: "#B5561F",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "4px 10px",
                          borderRadius: 20,
                        }}
                      >
                        {v.concept_covered}
                      </div>
                    )}
                  </div>
                  <div style={{ color: "#C0392B", fontSize: 18, flex: "0 0 18px" }}>↗</div>
                </div>
              </a>
            );
          })}
          <div style={{ fontSize: 12, color: "#A79E8E", textAlign: "center", marginTop: 8 }}>
            Links open YouTube — verify content is appropriate before watching.
          </div>
        </>
      )}
      {loading && <Loading emoji="▶" text="Finding the best videos…" />}
    </div>
  );
}

/* ============================ MIND MAP TAB ============================ */
function MindMapTab({
  mindMap,
  loading,
  generate,
}: {
  mindMap: MindMap | null;
  loading: boolean;
  generate: () => void;
}) {
  const btnLabel = loading ? "Building…" : mindMap ? "Rebuild" : "Build Mind Map";
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader
        title="Mind Map"
        subtitle="Full conceptual landscape of this topic"
        btnLabel={btnLabel}
        btnColor="#7A5AC2"
        onClick={generate}
      />
      {mindMap && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div
            style={{
              background: "linear-gradient(150deg,#23201B,#3A362E)",
              color: "#fff",
              borderRadius: 24,
              padding: "18px 36px",
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 22,
              boxShadow: "0 12px 30px -12px rgba(0,0,0,.5)",
            }}
          >
            {mindMap.center}
          </div>
          <div style={{ width: 2, height: 20, background: "#CFC7B8" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", width: "100%" }}>
            {mindMap.branches.map((b, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  border: `2px solid ${b.color || "#4C43D9"}`,
                  borderRadius: 20,
                  padding: "16px 18px",
                  minWidth: 180,
                  maxWidth: 220,
                  flex: 1,
                  animation: "jfade .4s ease",
                }}
              >
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 800,
                    fontSize: 15,
                    color: b.color || "#4C43D9",
                    marginBottom: 10,
                    borderBottom: "1px solid #F1ECE2",
                    paddingBottom: 8,
                  }}
                >
                  {b.label}
                </div>
                {b.children.map((c, ci) => (
                  <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, marginBottom: 6, lineHeight: 1.35 }}>
                    <span style={{ color: b.color || "#4C43D9", fontWeight: 700, flex: "0 0 8px", marginTop: 2 }}>•</span>
                    {c}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && <Loading emoji="🕸" text="Building concept map…" />}
    </div>
  );
}

/* ============================ shared tool bits ============================ */
function ToolHeader({
  title,
  subtitle,
  btnLabel,
  btnColor,
  onClick,
}: {
  title: string;
  subtitle: string;
  btnLabel: string;
  btnColor: string;
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#8A8172" }}>{subtitle}</div>
      </div>
      <button
        onClick={onClick}
        style={{
          background: btnColor,
          color: "#fff",
          border: "none",
          borderRadius: 14,
          padding: "12px 20px",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        {btnLabel}
      </button>
    </div>
  );
}
function Loading({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: 50, color: "#8A8172" }}>
      <div style={{ fontSize: 36, animation: "jpulse 1.2s infinite" }}>{emoji}</div>
      <div style={{ marginTop: 10, fontWeight: 600 }}>{text}</div>
    </div>
  );
}
