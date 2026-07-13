"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { stripMentionPrefix } from "@/lib/mentions";
import type {
  Flashcard,
  MindMap,
  ProgressEntry,
  QuizItem,
  Scaffold,
  Subject,
  ChatMessage,
} from "@/lib/types";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
type Screen = "home" | "tracker" | "lesson";
type Tab = "canvas" | "quiz" | "flashcards" | "videos" | "mindmap";
type Tracker = Record<string, ProgressEntry>;

// Index/framework files to hide from student view
const HIDDEN_FILE_PATTERNS = [
  /index/i,
  /framework.reference/i,
  /knowledge.base.index/i,
  /master.knowledge/i,
  /teaching.contract/i,
  /IB.teaching/i,
];

function isHiddenSubject(name: string): boolean {
  return HIDDEN_FILE_PATTERNS.some((p) => p.test(name));
}

function ring(pct: number, r: number) {
  const c = 2 * Math.PI * r;
  return { circ: c.toFixed(1), off: (c * (1 - pct / 100)).toFixed(1) };
}

type TopicImage = { id: string; image_url: string; thumbnail_url: string; alt_text: string; source: string };

type FlagItem = { id: string; topic_id: string; topic_name: string; subject_name: string; reason: string; created_at: string };
type NotifItem = { id: string; type: string; content: string; from_name: string | null; read: boolean; created_at: string };
type TeacherContentItem = { id: string; title: string; content_type: string; content: string; added_by?: string };
type Recipient = { id: string; name: string; role: string; displayName: string };

export default function StudentApp({
  user,
  initialSubjects,
  initialProgress,
}: {
  user: { id: string; name: string; email: string; role: string; linkedToSchool: boolean };
  initialSubjects: Subject[];
  initialProgress: ProgressEntry[];
  initialChunkCount?: number; // ponytail: library removed; prop kept so the (untouched) parent's pass-through still type-checks
}) {
  const router = useRouter();
  // School-side UI is opt-in: everything gated on `linked` stays invisible for standalone students.
  const linked = user.linkedToSchool;

  // Filter hidden subjects
  const visibleSubjects = useMemo(
    () => initialSubjects.filter((s) => !isHiddenSubject(s.name)),
    [initialSubjects]
  );

  const [subjects, setSubjects] = useState<Subject[]>(visibleSubjects);
  const [tracker, setTracker] = useState<Tracker>(() => {
    const t: Tracker = {};
    for (const p of initialProgress) t[p.topicId] = p;
    return t;
  });
  const [screen, setScreen] = useState<Screen>("home");
  const [muted, setMuted] = useState(false);

  // Notifications (bell)
  const [notifOpen, setNotifOpen] = useState(false);
  const [notif, setNotif] = useState<{ flags: FlagItem[]; messages: NotifItem[]; unreadCount: number }>({
    flags: [],
    messages: [],
    unreadCount: 0,
  });

  // Compose (student → teacher/guardian) in the notification panel
  const [composeText, setComposeText] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  // Voice settings
  const [voiceId, setVoiceId] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("jarvis_voice_id") || "";
    return "";
  });
  const [voices, setVoices] = useState<{ id: string; name: string; gender: string; category: string }[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [elConfigured, setElConfigured] = useState<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Lesson state
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
  const [sessionLoading, setSessionLoading] = useState(false);
  const queueRef = useRef<string[]>([]);

  // Study tools — all persisted
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

  // Topic images
  const [topicImages, setTopicImages] = useState<TopicImage[]>([]);

  // Teacher-published content for the open topic (school-linked only)
  const [teacherContent, setTeacherContent] = useState<TeacherContentItem[]>([]);

  const chatRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
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

  // Check ElevenLabs configured
  useEffect(() => {
    fetch("/api/config?key=elevenlabs_api_key")
      .then((r) => r.json())
      .then((j) => setElConfigured(!!j.value));
  }, []);

  // Load voices when voice picker opened
  useEffect(() => {
    if (showVoicePicker && voices.length === 0) {
      fetch("/api/elevenlabs/voices")
        .then((r) => r.json())
        .then((j) => { if (j.voices?.length) setVoices(j.voices); });
    }
  }, [showVoicePicker, voices.length]);

  // ---------------------------------------------------------------- voice
  const speakEl = useCallback(async (text: string) => {
    if (mutedRef.current) return;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: voiceId || undefined }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => setSpeaking(true);
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch { /* silent */ }
  }, [voiceId]);

  const speakBrowser = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    if (listeningRef.current) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`>]/g, ""));
    u.rate = 1.02; u.pitch = 1.0;
    const vs = window.speechSynthesis.getVoices();
    const pref = vs.find((v) => /(daniel|google uk|arthur|male)/i.test(v.name)) || vs.find((v) => /en/i.test(v.lang));
    if (pref) u.voice = pref;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback((text: string) => {
    if (elConfigured) speakEl(text);
    else speakBrowser(text);
  }, [elConfigured, speakEl, speakBrowser]);

  // ---------------------------------------------------------------- session persistence
  const saveSession = useCallback(async (topicId: string, topicName: string, subjectName: string, overrides?: Partial<{
    messages: ChatMessage[]; scaffold: Scaffold; stageIndex: number;
    quizData: QuizItem[]; quizState: Record<number, { answer: string; correct: boolean }>;
    flashcards: Flashcard[]; fcIndex: number;
    videos: import("@/lib/types").VideoItem[]; mindmap: MindMap | null;
  }>) => {
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicId, topicName, subjectName,
        messages: overrides?.messages ?? messages,
        scaffold: overrides?.scaffold ?? scaffold,
        stageIndex: overrides?.stageIndex ?? stageIndex,
        quizData: overrides?.quizData ?? quizData,
        quizState: overrides?.quizState ?? quizState,
        flashcards: overrides?.flashcards ?? flashcards,
        fcIndex: overrides?.fcIndex ?? fcIndex,
        videos: overrides?.videos ?? videos,
        mindmap: overrides?.mindmap !== undefined ? overrides.mindmap : mindMap,
      }),
    });
  }, [messages, scaffold, stageIndex, quizData, quizState, flashcards, fcIndex, videos, mindMap]);

  // ---------------------------------------------------------------- send
  const send = useCallback(
    async (text: string, isKick = false) => {
      const msg = (text || "").trim();
      if (!msg) return;
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
        const data = await res.json() as { say: string; stage?: number; scaffold: Scaffold; masteryDelta?: number };
        const say = data.say || "Let's keep going — tell me more about what you're thinking.";
        const newMessages = [...history, { role: "jarvis" as const, text: say }];
        const newScaffold = data.scaffold || {};
        const newStage = typeof data.stage === "number" ? data.stage : stageIndex;

        setMessages(newMessages);
        setScaffold(newScaffold);
        if (typeof data.stage === "number") setStageIndex(newStage);
        if (activeTopic && data.masteryDelta) {
          applyLocalDelta(activeTopic, activeSubject, data.masteryDelta);
        }
        setThinking(false);
        scrollChat();
        speak(say);

        // Auto-save session
        if (activeTopic && activeSubject) {
          saveSession(activeTopic.id, activeTopic.name, activeSubject.name, {
            messages: newMessages, scaffold: newScaffold, stageIndex: newStage,
          });
        }

        const q = queueRef.current;
        if (q.length) { const next = q.shift()!; setTimeout(() => sendRef.current(next), 50); }
      } catch {
        setMessages((m) => [...m, { role: "jarvis", text: "I had trouble thinking just now — could you say that again?" }]);
        setThinking(false);
      }
    },
    [messages, scaffold, stageIndex, activeTopic, activeSubject, speak, scrollChat, saveSession]
  );

  const sendRef = useRef(send);
  useEffect(() => void (sendRef.current = send), [send]);

  // Speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
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

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function toggleMic() {
    const r = recogRef.current;
    if (!r) { alert("Voice input needs Chrome/Safari with mic permission."); return; }
    if (listening) { r.stop(); setListening(false); }
    else { stopAudio(); try { r.start(); setListening(true); setChatInput(""); } catch { /* ignore */ } }
  }

  function interruptSpeech() { stopAudio(); toggleMic(); }

  function toggleMute() {
    const m = !muted;
    if (m) stopAudio();
    setMuted(m);
  }

  function selectVoice(id: string) {
    setVoiceId(id);
    if (typeof window !== "undefined") localStorage.setItem("jarvis_voice_id", id);
    setShowVoicePicker(false);
  }

  // ---------------------------------------------------------------- tracker
  function applyLocalDelta(topic: { id: string; name: string }, subject: Subject | null, delta: number, misconceptions: string[] = []) {
    setTracker((prev) => {
      const cur = prev[topic.id];
      const mastery = Math.max(0, Math.min(100, (cur?.mastery ?? 0) + delta));
      const misc = cur ? [...cur.misconceptions] : [];
      for (const x of misconceptions) if (x && !misc.includes(x)) misc.push(x);
      return {
        ...prev,
        [topic.id]: {
          topicId: topic.id, topicName: topic.name,
          subject: subject?.name || cur?.subject || "",
          icon: subject?.icon || cur?.icon || "📘",
          color: subject?.color || cur?.color || "#4C43D9",
          mastery, misconceptions: misc, lastSeen: Date.now(),
        },
      };
    });
  }

  // ---------------------------------------------------------------- open topic + restore session
  function openTopic(subject: Subject, topic: { id: string; name: string }) {
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
    setTopicImages([]);
    setTeacherContent([]);
    setScreen("lesson");
    setSessionLoading(true);

    // If a teacher has flagged this topic, steer Jarvis's opening at it (school-linked only).
    const flag = linked ? notif.flags.find((f) => f.topic_id === topic.id) : undefined;
    const flagPrefix = flag
      ? `Your teacher has flagged this topic for revision: ${flag.reason}. Let's focus on that today. `
      : "";
    const kick = () => {
      const existing = tracker[topic.id];
      const verb = existing && existing.mastery >= 75 ? "Revise" : existing ? "Continue" : "Start";
      setTimeout(() => sendRef.current(
        `${flagPrefix}${verb} a lesson on "${topic.name}" (${subject.name}). I'm a Grade 7 IB MYP student. Begin by discovering my goal and building the big-picture concept map.`,
        true
      ), 30);
    };

    // Load saved session
    fetch(`/api/session?topicId=${encodeURIComponent(topic.id)}`)
      .then((r) => r.json())
      .then((j) => {
        setSessionLoading(false);
        if (j.session) {
          const s = j.session;
          setMessages(s.messages || []);
          setScaffold(s.scaffold || {});
          setStageIndex(s.stageIndex || 0);
          setQuizData(s.quizData || []);
          setQuizState(s.quizState || {});
          setFlashcards(s.flashcards || []);
          setFcIndex(s.fcIndex || 0);
          setVideos(s.videos || []);
          setMindMap(s.mindmap || null);
          // If restoring — don't kick
        } else {
          kick(); // New session — kick off
        }
      })
      .catch(() => {
        setSessionLoading(false);
        kick();
      });

    // Load topic images
    fetch(`/api/images?topicName=${encodeURIComponent(topic.name)}&subjectName=${encodeURIComponent(subject.name)}`)
      .then((r) => r.json())
      .then((j) => setTopicImages(j.images || []));

    // Load teacher-published content for this topic (school-linked only)
    if (linked) {
      fetch(`/api/teacher/content?topicName=${encodeURIComponent(topic.name)}&subjectName=${encodeURIComponent(subject.name)}&visible=true`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.content) setTeacherContent(j.content); })
        .catch(() => {});
    }
  }

  async function resetSession() {
    if (!activeTopic) return;
    if (!window.confirm("Reset this session? All progress for this topic will be cleared.")) return;
    await fetch(`/api/session?topicId=${encodeURIComponent(activeTopic.id)}`, { method: "DELETE" });
    const subject = activeSubject!;
    const topic = activeTopic;
    setMessages([]); setScaffold({}); setStageIndex(0);
    setQuizData([]); setQuizState({}); setFlashcards([]); setVideos([]); setMindMap(null);
    setTimeout(() => sendRef.current(
      `Start a lesson on "${topic.name}" (${subject.name}). I'm a Grade 7 IB MYP student. Begin by discovering my goal and building the big-picture concept map.`,
      true
    ), 30);
  }

  // ---------------------------------------------------------------- study tools
  async function generateQuiz() {
    setQuizLoading(true);
    const res = await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }) });
    const j = await res.json().catch(() => ({}));
    const items = Array.isArray(j.items) ? j.items : [];
    setQuizData(items);
    setQuizState({});
    setQuizLoading(false);
    if (activeTopic && activeSubject) saveSession(activeTopic.id, activeTopic.name, activeSubject.name, { quizData: items, quizState: {} });
  }

  function answerQuiz(qi: number, answer: string) {
    const q = quizData[qi];
    if (!q || quizState[qi]) return;
    const correct = q.type === "mcq" ? answer === q.answer : answer.trim().toLowerCase().includes((q.answer || "").trim().toLowerCase().slice(0, 8));
    const newState = { ...quizState, [qi]: { answer, correct } };
    setQuizState(newState);
    if (activeTopic) {
      const delta = correct ? 8 : -3;
      applyLocalDelta(activeTopic, activeSubject, delta);
      fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId: activeTopic.id, topicName: activeTopic.name, subject: activeSubject?.name, icon: activeSubject?.icon, color: activeSubject?.color, masteryDelta: delta }) });
      if (activeSubject) saveSession(activeTopic.id, activeTopic.name, activeSubject.name, { quizState: newState });
    }
  }

  async function generateFlashcards() {
    setFcLoading(true);
    const res = await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }) });
    const j = await res.json().catch(() => ({}));
    const items = Array.isArray(j.items) ? j.items : [];
    setFlashcards(items); setFcIndex(0); setFcFlipped(false);
    setFcLoading(false);
    if (activeTopic && activeSubject) saveSession(activeTopic.id, activeTopic.name, activeSubject.name, { flashcards: items, fcIndex: 0 });
  }

  async function generateVideos() {
    setVideosLoading(true);
    const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }) });
    const j = await res.json().catch(() => ({}));
    const items = Array.isArray(j.items) ? j.items : [];
    setVideos(items); setVideosLoading(false);
    if (activeTopic && activeSubject) saveSession(activeTopic.id, activeTopic.name, activeSubject.name, { videos: items });
  }

  async function generateMindMap() {
    setMindMapLoading(true);
    const res = await fetch("/api/mindmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: activeSubject?.name, topic: activeTopic?.name }) });
    const j = await res.json().catch(() => ({}));
    const mm = j.mindMap || null;
    setMindMap(mm); setMindMapLoading(false);
    if (activeTopic && activeSubject) saveSession(activeTopic.id, activeTopic.name, activeSubject.name, { mindmap: mm });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  // ---------------------------------------------------------------- notifications
  useEffect(() => {
    if (!linked) return; // standalone students never poll or see notifications
    let alive = true;
    const loadNotif = () =>
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j) setNotif({ flags: j.flags || [], messages: j.messages || [], unreadCount: j.unreadCount || 0 });
        })
        .catch(() => {});
    loadNotif();
    const t = setInterval(loadNotif, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [linked]);

  async function markNotifRead(id: string) {
    setNotif((n) => ({
      ...n,
      messages: n.messages.map((m) => (m.id === id ? { ...m, read: true } : m)),
      unreadCount: Math.max(0, n.unreadCount - 1),
    }));
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: id }),
    }).catch(() => {});
  }

  // Fetch the @mention recipient list once when the panel first opens.
  useEffect(() => {
    if (!linked || !notifOpen || recipients.length > 0) return;
    fetch("/api/wall/recipients")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.recipients)) setRecipients(j.recipients); })
      .catch(() => {});
  }, [linked, notifOpen, recipients.length]);

  // The word currently being typed, if it starts with '@' (drives the mention dropdown).
  const mentionQuery = useMemo(() => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(composeText);
    return m ? m[1] : null;
  }, [composeText]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return recipients.filter((r) => (r.displayName || r.name).toLowerCase().includes(q));
  }, [mentionQuery, recipients]);

  function insertMention(r: Recipient) {
    const label = r.displayName || r.name;
    setComposeText((t) => t.replace(/@[^\s@]*$/, `@${label} `));
  }

  async function sendWallMessage() {
    const content = composeText.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("send failed");
      setComposeText("");
      // Refresh notifications so any resulting message shows up.
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j) setNotif({ flags: j.flags || [], messages: j.messages || [], unreadCount: j.unreadCount || 0 }); })
        .catch(() => {});
    } catch {
      setSendError("Couldn't send — please try again.");
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------------------- derived
  const dueList = useMemo(() => {
    const now = Date.now();
    return Object.values(tracker).map((o) => {
      const interval = o.mastery >= 75 ? 4 : o.mastery >= 40 ? 2 : 1;
      const due = (o.lastSeen || now) + interval * 86400000;
      return { id: o.topicId, name: o.topicName, due, overdue: now >= due };
    }).sort((a, b) => a.due - b.due);
  }, [tracker]);

  const fmt = (d: number) => { const days = Math.round((d - Date.now()) / 86400000); return days <= 0 ? "now" : days + "d"; };
  const findGo = (id: string) => {
    for (const s of subjects) { const t = s.topics.find((x) => x.id === id); if (t) return () => openTopic(s, t); }
    return () => {};
  };

  // Topic ids with an unresolved teacher flag (empty for standalone students).
  const flaggedIds = useMemo(
    () => new Set(linked ? notif.flags.map((f) => f.topic_id) : []),
    [linked, notif.flags]
  );

  // All in-progress topics sorted by lastSeen
  const inProgressTopics = useMemo(() => {
    return Object.values(tracker)
      .filter((o) => o.mastery > 0 || o.lastSeen > 0)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 5);
  }, [tracker]);

  const at = activeTopic;
  const mv = at && tracker[at.id] ? tracker[at.id].mastery : 0;
  const mr = ring(mv, 16);

  const stageDefs: [string, string][] = [
    ["🎯", "Goal"], ["🗺", "Big picture"], ["🤔", "Inquiry"], ["📚", "Explain"],
    ["◆", "IB lens"], ["⚠", "Misconceptions"], ["✅", "Check"], ["🌱", "Reinforce"],
  ];
  const layerBg = ["#ECEBFB", "#E4F3EC", "#FBE9DC", "#F3F1FB", "#23201B"];
  const layerFg = ["#372FB0", "#1E7A50", "#B5561F", "#4C43D9", "#fff"];

  const allTopics: { name: string; subject: string; icon: string; pct: number; color: string; go: () => void }[] = [];
  subjects.forEach((s) => s.topics.forEach((t) => {
    const tr = tracker[t.id];
    if (tr) allTopics.push({ name: t.name, subject: s.name, icon: s.icon, pct: tr.mastery, color: tr.mastery >= 75 ? "#2E9E6B" : tr.mastery >= 40 ? "#E8823A" : "#C0392B", go: () => openTopic(s, t) });
  }));

  const misconLog: { topic: string; text: string }[] = [];
  Object.values(tracker).forEach((o) => o.misconceptions.forEach((x) => misconLog.push({ topic: o.topicName, text: x })));
  const schedule = dueList.map((d) => ({ name: d.name, when: d.overdue ? "Due now" : "in " + fmt(d.due) }));

  const canvasEmpty = !scaffold.cm && !scaffold.layers && !scaffold.inquiry && !scaffold.ib && !scaffold.reinf && !thinking && messages.length <= 1;

  const navBtn = (scr: Screen): React.CSSProperties => ({
    width: 52, height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 22,
    background: screen === scr ? "#4C43D9" : "transparent", color: screen === scr ? "#fff" : "#8A8172",
  });
  const tabSty = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "9px 4px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
    borderBottom: `3px solid ${active ? "#4C43D9" : "transparent"}`, background: "transparent",
    color: active ? "#4C43D9" : "#8A8172",
  });

  return (
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", background: "#EFEAE0" }}>
      {/* Voice Picker Modal */}
      {showVoicePicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 24, padding: 28, width: 560, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, marginBottom: 6 }}>Choose your voice</div>
            <div style={{ fontSize: 14, color: "#8A8172", marginBottom: 18 }}>This voice will be used for all lessons. Powered by ElevenLabs.</div>
            <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {voices.length === 0 && <div style={{ gridColumn: "1/3", textAlign: "center", padding: 40, color: "#8A8172" }}>Loading voices…</div>}
              {voices.map((v) => (
                <button key={v.id} onClick={() => selectVoice(v.id)}
                  style={{ border: `2px solid ${voiceId === v.id ? "#4C43D9" : "#E7E1D6"}`, background: voiceId === v.id ? "#F3F1FB" : "#FAF8F3", borderRadius: 14, padding: "14px 16px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#23201B" }}>{v.name}</div>
                  <div style={{ fontSize: 12, color: "#8A8172" }}>{v.gender} · {v.category}</div>
                  {voiceId === v.id && <div style={{ fontSize: 11, color: "#4C43D9", fontWeight: 700, marginTop: 4 }}>✓ Selected</div>}
                </button>
              ))}
            </div>
            <button onClick={() => setShowVoicePicker(false)} style={{ marginTop: 18, background: "#23201B", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS PANEL */}
      {linked && notifOpen && (
        <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 120 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, width: 380, maxWidth: "90vw", height: "100vh", background: "#EFEAE0", boxShadow: "-8px 0 24px rgba(0,0,0,.18)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2DBCE", background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, flex: 1 }}>Notifications</div>
              <button onClick={() => setNotifOpen(false)} style={{ background: "#F1ECE2", border: "none", width: 32, height: 32, borderRadius: 10, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {notif.flags.length === 0 && notif.messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#8A8172", fontSize: 14, padding: 40 }}>You&apos;re all caught up.</div>
              )}

              {notif.flags.map((f) => (
                <div key={f.id} style={{ background: "#fff", border: "1px solid #F0C9C4", borderLeft: "4px solid #C0392B", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#C0392B", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>⚑ Flagged topic</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#23201B" }}>{f.topic_name}</div>
                  <div style={{ fontSize: 12, color: "#8A8172", marginBottom: 6 }}>{f.subject_name}</div>
                  <div style={{ fontSize: 13, color: "#3A362E", lineHeight: 1.4, marginBottom: 10 }}>{f.reason}</div>
                  <button onClick={() => { setNotifOpen(false); findGo(f.topic_id)(); }} style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Go to topic →</button>
                </div>
              ))}

              {notif.messages.map((m) => (
                <div key={m.id} onClick={() => !m.read && markNotifRead(m.id)} style={{ background: "#fff", border: "1px solid #E7E1D6", borderLeft: `4px solid ${m.read ? "#E7E1D6" : "#4C43D9"}`, borderRadius: 12, padding: "12px 14px", cursor: m.read ? "default" : "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#4C43D9", textTransform: "uppercase", letterSpacing: ".05em" }}>{m.type === "flag" ? "⚑ Flag" : m.type === "note" ? "📝 Note" : "💬 Message"}</span>
                    {m.from_name && <span style={{ fontSize: 12, color: "#8A8172" }}>from {m.from_name}</span>}
                    {!m.read && <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: 4, background: "#4C43D9" }} />}
                  </div>
                  <div style={{ fontSize: 14, color: "#3A362E", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{stripMentionPrefix(m.content)}</div>
                </div>
              ))}
            </div>

            {/* Compose — student replies to a teacher/guardian */}
            <div style={{ borderTop: "1px solid #E2DBCE", background: "#fff", padding: "14px 16px", position: "relative" }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, marginBottom: 8, color: "#23201B" }}>Send a message</div>
              {mentionMatches.length > 0 && (
                <div style={{ position: "absolute", left: 16, right: 16, bottom: 108, background: "#fff", border: "1px solid #E7E1D6", borderRadius: 12, boxShadow: "0 8px 20px rgba(0,0,0,.14)", maxHeight: 180, overflowY: "auto", zIndex: 5 }}>
                  {mentionMatches.map((r) => (
                    <button key={r.id} onClick={() => insertMention(r)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #F1ECE2", padding: "9px 12px", cursor: "pointer" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#23201B" }}>{r.displayName || r.name}</span>
                      <span style={{ fontSize: 12, color: "#8A8172", marginLeft: 6 }}>{r.role.replace(/_/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea value={composeText} onChange={(e) => setComposeText(e.target.value)}
                placeholder="Write a message… type @ to mention a teacher or guardian"
                rows={2}
                style={{ width: "100%", boxSizing: "border-box", resize: "none", border: "1px solid #E0D9CC", borderRadius: 12, padding: "10px 12px", fontSize: 14, fontFamily: DISPLAY, maxHeight: 120 }} />
              {sendError && <div style={{ fontSize: 12, color: "#C0392B", marginTop: 6 }}>{sendError}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={sendWallMessage} disabled={!composeText.trim() || sending}
                  style={{ background: !composeText.trim() || sending ? "#C7C2F0" : "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: !composeText.trim() || sending ? "default" : "pointer" }}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEFT RAIL */}
      <div style={{ width: 88, flex: "0 0 88px", background: "#23201B", display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 0", gap: 8, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(150deg,#6B62F5,#4C43D9)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, color: "#fff", fontSize: 22, boxShadow: "0 6px 18px rgba(76,67,217,.5)", marginBottom: 14 }}>J</div>
        <button onClick={() => setScreen("home")} title="Home" style={navBtn("home")}>⌂</button>
        <button onClick={() => setScreen("tracker")} title="Progress Tracker" style={navBtn("tracker")}>◔</button>
        {linked && (
          <button onClick={() => setNotifOpen(true)} title="Notifications" style={{ ...navBtn("home"), background: notifOpen ? "#4C43D9" : "transparent", position: "relative" }}>
            🔔
            {(notif.unreadCount + notif.flags.length) > 0 && (
              <span style={{ position: "absolute", top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, background: "#C0392B", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                {notif.unreadCount + notif.flags.length}
              </span>
            )}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {elConfigured && (
          <button onClick={() => setShowVoicePicker(true)} title="Choose voice" style={{ width: 52, height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 20, background: voiceId ? "#4C43D9" : "#3A362E", color: "#fff" }}>🎙</button>
        )}
        <button onClick={toggleMute} title="Mute voice" style={{ width: 52, height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 20, background: muted ? "#C0392B" : "#3A362E", color: "#fff" }}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button onClick={logout} title="Logout" style={{ width: 52, height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 18, background: "transparent", color: "#8A8172", marginTop: 4 }}>⏻</button>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
        {screen === "home" && (
          <HomeScreen
            name={user.name} subjects={subjects} tracker={tracker} dueList={dueList}
            fmt={fmt} findGo={findGo} inProgressTopics={inProgressTopics}
            openTopic={openTopic}
            flaggedIds={flaggedIds}
          />
        )}

        {screen === "tracker" && (
          <TrackerScreen tracker={tracker} allTopics={allTopics} misconLog={misconLog} schedule={schedule} dueList={dueList} />
        )}

        {screen === "lesson" && activeTopic && (
          <div style={{ display: "flex", height: "100vh" }}>
            {/* Conversation column */}
            <div style={{ flex: "0 0 46%", maxWidth: 560, display: "flex", flexDirection: "column", borderRight: "1px solid #E2DBCE", background: "#F6F3EC" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid #E2DBCE", display: "flex", alignItems: "center", gap: 12, background: "#fff" }}>
                <button onClick={() => setScreen("home")} style={{ background: "#F1ECE2", border: "none", width: 34, height: 34, borderRadius: 10, cursor: "pointer", fontSize: 16 }}>←</button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>{activeTopic.name}</div>
                  <div style={{ fontSize: 12, color: "#8A8172" }}>{activeSubject?.name} · with Jarvis</div>
                </div>
                <button onClick={resetSession} title="Reset session" style={{ background: "#FBE9DC", border: "none", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#E8823A" }}>↺ Reset</button>
                <div style={{ position: "relative", width: 40, height: 40 }}>
                  <svg viewBox="0 0 40 40" style={{ width: 40, height: 40, transform: "rotate(-90deg)" }}>
                    <circle cx="20" cy="20" r="16" fill="none" stroke="#EEE9DF" strokeWidth="5" />
                    <circle cx="20" cy="20" r="16" fill="none" stroke="#2E9E6B" strokeWidth="5" strokeLinecap="round" strokeDasharray={mr.circ} strokeDashoffset={mr.off} />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{mv}%</div>
                </div>
              </div>

              <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                {sessionLoading && (
                  <div style={{ textAlign: "center", padding: 40, color: "#8A8172" }}>
                    <div style={{ fontSize: 28, animation: "jpulse 1.2s infinite" }}>💾</div>
                    <div style={{ marginTop: 8, fontWeight: 600, fontSize: 14 }}>Restoring your session…</div>
                  </div>
                )}
                {!sessionLoading && messages.map((m, i) => {
                  const u = m.role === "user";
                  return (
                    <div key={i} style={{ alignSelf: u ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                      <div style={{ fontSize: 11, color: "#A79E8E", marginBottom: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", textAlign: u ? "right" : "left" }}>
                        {u ? "You" : "Jarvis"}
                      </div>
                      <div style={{ background: u ? "#4C43D9" : "#fff", color: u ? "#fff" : "#23201B", padding: "12px 15px", borderRadius: u ? "16px 16px 4px 16px" : "16px 16px 16px 4px", fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {m.text}
                      </div>
                    </div>
                  );
                })}
                {thinking && (
                  <div style={{ alignSelf: "flex-start", background: "#fff", border: "1px solid #E7E1D6", padding: "14px 18px", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 5 }}>
                    {[0, 0.2, 0.4].map((d) => <span key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: "#4C43D9", animation: `jdot 1.2s infinite ${d}s` }} />)}
                  </div>
                )}
              </div>

              <div style={{ padding: "16px 20px", borderTop: "1px solid #E2DBCE", background: "#fff" }}>
                {speaking && <div onClick={interruptSpeech} style={{ textAlign: "center", fontSize: 13, color: "#4C43D9", fontWeight: 700, marginBottom: 8, cursor: "pointer", userSelect: "none" }}>🔊 Jarvis is speaking — tap to interrupt</div>}
                {listening && <div style={{ textAlign: "center", fontSize: 13, color: "#E8823A", fontWeight: 700, marginBottom: 8 }}>● Listening… speak now</div>}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <button onClick={toggleMic} style={{ flex: "0 0 52px", height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 22, background: listening ? "#FBE9DC" : "#F1ECE2", color: listening ? "#E8823A" : "#5A5347", position: "relative" }}>
                    {listening && <span style={{ position: "absolute", inset: -4, borderRadius: 20, border: "2px solid #E8823A", animation: "jpulse 1.1s infinite" }} />}
                    🎙
                  </button>
                  <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(chatInput); } }}
                    placeholder="Ask Jarvis, or answer aloud…" rows={1}
                    style={{ flex: 1, resize: "none", border: "1px solid #E0D9CC", borderRadius: 14, padding: "14px 15px", fontSize: 15, maxHeight: 120 }} />
                  <button onClick={() => send(chatInput)} style={{ flex: "0 0 52px", height: 52, borderRadius: 16, border: "none", cursor: "pointer", fontSize: 20, background: "#4C43D9", color: "#fff" }}>↑</button>
                </div>
              </div>
            </div>

            {/* Canvas column */}
            <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "0 0 60px", background: "#EFEAE0", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E7E1D6", padding: "0 20px", position: "sticky", top: 0, zIndex: 10 }}>
                <button onClick={() => setLessonTab("canvas")} style={tabSty(lessonTab === "canvas")}>🧭 Canvas</button>
                <button onClick={() => setLessonTab("quiz")} style={tabSty(lessonTab === "quiz")}>📝 Quiz</button>
                <button onClick={() => setLessonTab("flashcards")} style={tabSty(lessonTab === "flashcards")}>🗂 Flashcards</button>
                <button onClick={() => setLessonTab("videos")} style={tabSty(lessonTab === "videos")}>▶ Videos</button>
                <button onClick={() => setLessonTab("mindmap")} style={tabSty(lessonTab === "mindmap")}>🕸 Mind Map</button>
              </div>

              {lessonTab === "canvas" && <CanvasTab scaffold={scaffold} stageIndex={stageIndex} stageDefs={stageDefs} layerBg={layerBg} layerFg={layerFg} canvasEmpty={canvasEmpty} topicImages={topicImages} teacherContent={teacherContent} />}
              {lessonTab === "quiz" && <QuizTab quizData={quizData} quizState={quizState} quizLoading={quizLoading} generateQuiz={generateQuiz} answerQuiz={answerQuiz} topicImages={topicImages} teacherContent={teacherContent} />}
              {lessonTab === "flashcards" && <FlashcardsTab flashcards={flashcards} fcIndex={fcIndex} fcFlipped={fcFlipped} fcLoading={fcLoading} generate={generateFlashcards} flip={() => setFcFlipped((f) => !f)} next={() => { setFcIndex((i) => (i + 1) % flashcards.length); setFcFlipped(false); }} prev={() => { setFcIndex((i) => (i - 1 + flashcards.length) % flashcards.length); setFcFlipped(false); }} topicImages={topicImages} teacherContent={teacherContent} />}
              {lessonTab === "videos" && <VideosTab videos={videos} loading={videosLoading} generate={generateVideos} topicImages={topicImages} teacherContent={teacherContent} />}
              {lessonTab === "mindmap" && <MindMapTab mindMap={mindMap} loading={mindMapLoading} generate={generateMindMap} topicImages={topicImages} teacherContent={teacherContent} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== USEFUL RESOURCES SECTION ===== */
function UsefulResources({ images }: { images: TopicImage[] }) {
  if (!images.length) return null;
  return (
    <div style={{ marginTop: 28, borderTop: "1px solid #E7E1D6", paddingTop: 20 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, color: "#5A5347", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".06em" }}>📸 Useful Resources</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {images.map((img) => (
          <a key={img.id} href={img.image_url} target="_blank" rel="noreferrer" style={{ display: "block", borderRadius: 16, overflow: "hidden", border: "1px solid #E7E1D6", textDecoration: "none" }}>
            <img src={img.thumbnail_url} alt={img.alt_text} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }}
              onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/400x250?text=Image"; }} />
            <div style={{ padding: "10px 12px", background: "#fff" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#23201B" }}>{img.alt_text}</div>
              <div style={{ fontSize: 11, color: "#8A8172", marginTop: 2 }}>{img.source === "ai" ? "🎨 AI generated" : img.source === "web" ? "🔍 Web image" : "📎 Curated"} · Click to view full size</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ===== HOME ===== */
function HomeScreen({
  name, subjects, tracker, dueList, fmt, findGo, inProgressTopics, openTopic, flaggedIds,
}: {
  name: string; subjects: Subject[]; tracker: Tracker;
  dueList: { id: string; name: string; due: number; overdue: boolean }[];
  fmt: (d: number) => string; findGo: (id: string) => () => void;
  inProgressTopics: ProgressEntry[];
  openTopic: (s: Subject, t: { id: string; name: string }) => void;
  flaggedIds: Set<string>;
}) {
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const dueTopics = dueList.slice(0, 3).map((d) => ({ name: d.name, when: d.overdue ? "due now" : fmt(d.due), id: d.id }));

  function toggleSubject(id: string) {
    setExpandedSubjects((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function goToTopic(id: string, subjects: Subject[], openTopic: (s: Subject, t: { id: string; name: string }) => void) {
    for (const s of subjects) {
      const t = s.topics.find((x) => x.id === id);
      if (t) { openTopic(s, t); return; }
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "54px 48px 80px", animation: "jfade .4s ease" }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 15, letterSpacing: ".14em", textTransform: "uppercase", color: "#8A8172" }}>IB MYP · Self-Learning Studio</div>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, lineHeight: 1.05, margin: "10px 0 4px", letterSpacing: "-.02em" }}>Hi {name} 👋</h1>
      <p style={{ fontSize: 18, color: "#6B6459", margin: "0 0 28px", maxWidth: 620 }}>What would you like to understand today? Pick a topic and Jarvis will teach it the IB way — through inquiry, not memorising.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 40 }}>
        {/* In-progress / resume */}
        <div style={{ background: "linear-gradient(150deg,#4C43D9,#6B62F5)", borderRadius: 24, padding: "24px 28px", color: "#fff", boxShadow: "0 18px 40px -18px rgba(76,67,217,.7)" }}>
          <div style={{ fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", opacity: 0.8, fontFamily: DISPLAY, marginBottom: 12 }}>Continue learning</div>
          {inProgressTopics.length === 0 ? (
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>Start your first lesson</div>
              <div style={{ opacity: 0.85, marginTop: 6, fontSize: 14 }}>Choose any subject below to begin</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {inProgressTopics.map((p) => (
                <button key={p.topicId} onClick={() => goToTopic(p.topicId, subjects, openTopic)}
                  style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 14, padding: "12px 16px", cursor: "pointer", textAlign: "left", color: "#fff" }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>{p.topicName}</div>
                  <div style={{ opacity: 0.8, fontSize: 13, marginTop: 2 }}>{p.subject} · {p.mastery}% mastery</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Revision due */}
        <div style={{ background: "#fff", borderRadius: 24, padding: 24, border: "1px solid #E7E1D6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>
            <span style={{ color: "#E8823A" }}>↻</span> Revision due
          </div>
          <div style={{ fontSize: 13, color: "#8A8172", marginBottom: 12 }}>Spaced repetition keeps it in long-term memory.</div>
          {dueTopics.map((d) => (
            <button key={d.id} onClick={findGo(d.id)}
              style={{ width: "100%", textAlign: "left", background: "#FBF4EC", border: "1px solid #F0E2D2", borderRadius: 12, padding: "11px 13px", marginBottom: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</span>
              <span style={{ fontSize: 11, color: "#E8823A", fontWeight: 700 }}>{d.when}</span>
            </button>
          ))}
          {dueTopics.length === 0 && <div style={{ fontSize: 13, color: "#A79E8E", padding: "8px 2px" }}>Nothing due — you&apos;re on track. 🎉</div>}
        </div>
      </div>

      {/* Subjects — collapsible grid */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, margin: 0 }}>Your subjects</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {subjects.map((s, si) => {
          const expanded = !!expandedSubjects[s.id];
          const pctNum = s.topics.length ? Math.round(s.topics.reduce((a, t) => a + (tracker[t.id]?.mastery || 0), 0) / s.topics.length) : 0;
          const mastered = s.topics.filter((t) => (tracker[t.id]?.mastery || 0) >= 75).length;
          const inProgress = s.topics.filter((t) => { const m = tracker[t.id]?.mastery || 0; return m > 0 && m < 75; }).length;
          const rv = ring(pctNum, 16);
          const palette = ["#4C43D9", "#2E9E6B", "#E8823A", "#C0392B", "#7A5AC2"];
          const color = palette[si % palette.length];

          return (
            <div key={s.id} style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 20, overflow: "hidden" }}>
              {/* Header row */}
              <button onClick={() => toggleSubject(s.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "18px 22px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: s.soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flex: "0 0 44px" }}>{s.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, color: "#23201B" }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: "#8A8172", marginTop: 2 }}>
                    {s.topics.length} topics · {mastered} mastered
                    {inProgress > 0 && <span style={{ color: "#E8823A", marginLeft: 6 }}>· {inProgress} in progress</span>}
                  </div>
                </div>
                {/* Mini progress bar */}
                <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ height: 6, background: "#EEE9DF", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pctNum}%`, background: color, borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 12, color, fontWeight: 700 }}>{pctNum}% avg mastery</div>
                </div>
                <div style={{ fontSize: 20, color: "#8A8172", transform: expanded ? "rotate(180deg)" : "none", transition: ".2s" }}>⌄</div>
              </button>

              {/* Expanded topics grid */}
              {expanded && (
                <div style={{ borderTop: "1px solid #F1ECE2", padding: "16px 22px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                  {s.topics.map((t) => {
                    const m = tracker[t.id]?.mastery || 0;
                    const dot = m >= 75 ? "#2E9E6B" : m > 0 ? "#E8823A" : "#CFC7B8";
                    const badge = m >= 75 ? "Mastered" : m > 0 ? m + "%" : "New";
                    const badgeBg = m >= 75 ? "#E4F3EC" : m > 0 ? "#FBE9DC" : "#F1ECE2";
                    const badgeColor = m >= 75 ? "#1E7A50" : m > 0 ? "#B5561F" : "#8A8172";
                    return (
                      <button key={t.id} onClick={() => openTopic(s, t)}
                        style={{ display: "flex", alignItems: "center", gap: 10, background: "#FAF8F3", border: "1px solid #EEE9DF", borderRadius: 12, padding: "11px 14px", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flex: "0 0 8px" }} />
                        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: "#23201B", lineHeight: 1.3 }}>{t.name}</span>
                        {flaggedIds.has(t.id) && <span style={{ fontSize: 11, background: "#FDECEA", color: "#C0392B", borderRadius: 20, padding: "3px 8px", fontWeight: 800, whiteSpace: "nowrap" }}>⚑ Flagged</span>}
                        <span style={{ fontSize: 11, background: badgeBg, color: badgeColor, borderRadius: 20, padding: "3px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{badge}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== TRACKER ===== */
function TrackerScreen({ tracker, allTopics, misconLog, schedule, dueList }: {
  tracker: Tracker;
  allTopics: { name: string; subject: string; icon: string; pct: number; color: string; go: () => void }[];
  misconLog: { topic: string; text: string }[];
  schedule: { name: string; when: string }[];
  dueList: { overdue: boolean }[];
}) {
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
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, margin: "0 0 4px", letterSpacing: "-.02em" }}>Progress Tracker</h1>
      <p style={{ fontSize: 17, color: "#6B6459", margin: "0 0 30px" }}>Where you&apos;re strong, where to revise, and what&apos;s due next.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 32 }}>
        {stat(statTopics, "Topics started", "#4C43D9")}
        {stat(statMastered, "Mastered (75%+)", "#2E9E6B")}
        {stat(statDue, "Due for revision", "#E8823A")}
        {stat(statMiscon, "Misconceptions", "#C0392B")}
      </div>
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, margin: "0 0 14px" }}>Mastery by topic</h2>
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: "8px 20px", marginBottom: 30 }}>
        {allTopics.length === 0 && <div style={{ fontSize: 14, color: "#A79E8E", padding: "16px 0" }}>Start a lesson to begin tracking mastery.</div>}
        {allTopics.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid #F1ECE2" }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</div><div style={{ fontSize: 12, color: "#A79E8E" }}>{t.subject}</div></div>
            <div style={{ width: 180, height: 9, background: "#EEE9DF", borderRadius: 6, overflow: "hidden" }}><div style={{ height: "100%", width: `${t.pct}%`, background: t.color, borderRadius: 6 }} /></div>
            <div style={{ width: 44, textAlign: "right", fontWeight: 700, fontSize: 14, color: t.color }}>{t.pct}%</div>
            <button onClick={t.go} style={{ background: "#F3F1FB", color: "#4C43D9", border: "none", borderRadius: 9, padding: "7px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Revise</button>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 12, color: "#C0392B" }}>⚠ Misconceptions to fix</div>
          {misconLog.map((m, i) => <div key={i} style={{ fontSize: 14, padding: "9px 0", borderBottom: "1px solid #F1ECE2" }}><strong>{m.topic}:</strong> {m.text}</div>)}
          {misconLog.length === 0 && <div style={{ fontSize: 13, color: "#A79E8E" }}>None logged yet.</div>}
        </div>
        <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 12, color: "#E8823A" }}>↻ Spaced-repetition schedule</div>
          {schedule.map((s, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "9px 0", borderBottom: "1px solid #F1ECE2" }}><span>{s.name}</span><span style={{ color: "#E8823A", fontWeight: 700 }}>{s.when}</span></div>)}
          {schedule.length === 0 && <div style={{ fontSize: 13, color: "#A79E8E" }}>Nothing scheduled yet.</div>}
        </div>
      </div>
    </div>
  );
}

/* ===== CANVAS TAB ===== */
function CanvasTab({ scaffold, stageIndex, stageDefs, layerBg, layerFg, canvasEmpty, topicImages, teacherContent }: {
  scaffold: Scaffold; stageIndex: number; stageDefs: [string, string][];
  layerBg: string[]; layerFg: string[]; canvasEmpty: boolean; topicImages: TopicImage[];
  teacherContent: TeacherContentItem[];
}) {
  const cm = scaffold.cm;
  const ib = scaffold.ib;
  const chip = (bg: string, color: string) => (v: string, i: number) => (
    <span key={i} style={{ background: bg, color, padding: "5px 11px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}>{v}</span>
  );
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {stageDefs.map((d, i) => {
          const done = i < stageIndex; const cur = i === stageIndex;
          return <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, background: cur ? "#4C43D9" : done ? "#E4F3EC" : "#fff", color: cur ? "#fff" : done ? "#1E7A50" : "#A79E8E", border: `1px solid ${cur ? "#4C43D9" : done ? "#BEE3CF" : "#E7E1D6"}`, padding: "7px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}><span>{d[0]}</span>{d[1]}</div>;
        })}
      </div>

      {cm && (
        <Card>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>🗺 The Big Picture</div>
          <div style={{ textAlign: "center", background: "linear-gradient(150deg,#4C43D9,#6B62F5)", color: "#fff", borderRadius: 16, padding: 16, fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, margin: "12px 0 18px" }}>{cm.core}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <CmGroup title="Key concepts" titleColor="#4C43D9">{cm.keyConcepts.map(chip("#ECEBFB", "#372FB0"))}</CmGroup>
            <CmGroup title="Related concepts" titleColor="#E8823A">{cm.related.map(chip("#FBE9DC", "#B5561F"))}</CmGroup>
            <CmGroup title="Vocabulary" titleColor="#6B6459">{cm.vocab.map(chip("#F1ECE2", "#5A5347"))}</CmGroup>
            <CmGroup title="Real-world links" titleColor="#2E9E6B">{cm.applications.map(chip("#E4F3EC", "#1E7A50"))}</CmGroup>
          </div>
        </Card>
      )}

      {scaffold.inquiry && scaffold.inquiry.length > 0 && (
        <div style={{ background: "#FBF4EC", border: "1px solid #F0E2D2", borderRadius: 20, padding: 22, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 12 }}>🤔 Think first</div>
          {scaffold.inquiry.map((q, i) => <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 15, lineHeight: 1.45 }}><span style={{ color: "#E8823A", fontWeight: 800 }}>?</span>{q}</div>)}
        </div>
      )}

      {scaffold.layers && scaffold.layers.length > 0 && (
        <Card>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 14 }}>📚 Explained in layers</div>
          {scaffold.layers.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div style={{ flex: "0 0 34px", height: 34, borderRadius: 10, background: layerBg[(l.level - 1) % 5] || "#ECEBFB", color: layerFg[(l.level - 1) % 5] || "#372FB0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: DISPLAY }}>{l.level}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{l.title}</div><div style={{ fontSize: 14, color: "#4A453C", lineHeight: 1.5 }}>{l.text}</div></div>
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
            <div style={{ gridColumn: "1 / 3" }}><div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em" }}>Statement of inquiry</div><div style={{ fontSize: 15, marginTop: 3, lineHeight: 1.45, fontStyle: "italic" }}>&quot;{ib.soi}&quot;</div></div>
          </div>
          {ib.atl && ib.atl.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.15)" }}>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>ATL skills you&apos;re using</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{ib.atl.map((a, i) => <span key={i} style={{ background: "rgba(255,255,255,.12)", padding: "5px 11px", borderRadius: 20, fontSize: 13 }}>{a}</span>)}</div>
            </div>
          )}
        </div>
      )}

      {scaffold.miscon && scaffold.miscon.length > 0 && (
        <div style={{ background: "#FDF0EE", border: "1px solid #F5D5CF", borderRadius: 20, padding: 22, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 12, color: "#C0392B" }}>⚠ Watch out for this</div>
          {scaffold.miscon.map((m, i) => <div key={i} style={{ marginBottom: 12 }}><div style={{ fontSize: 14, fontWeight: 700 }}>Many think: &quot;{m.think}&quot;</div><div style={{ fontSize: 14, color: "#4A453C", lineHeight: 1.5, marginTop: 3 }}>{m.why}</div></div>)}
        </div>
      )}

      {scaffold.checkpoint && (
        <div style={{ background: "linear-gradient(150deg,#2E9E6B,#38B87C)", color: "#fff", borderRadius: 20, padding: 24, marginBottom: 16, animation: "jfade .4s ease" }}>
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>Mastery checkpoint · Level {scaffold.checkpoint.level}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, margin: "8px 0 6px", lineHeight: 1.25 }}>{scaffold.checkpoint.question}</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>Answer by voice 🎙 or type — Jarvis will check your thinking.</div>
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
          {scaffold.reflection.map((r, i) => <div key={i} style={{ fontSize: 15, marginBottom: 9, lineHeight: 1.45 }}>{r}</div>)}
        </div>
      )}

      {canvasEmpty && (
        <div style={{ textAlign: "center", color: "#A79E8E", padding: "60px 20px" }}>
          <div style={{ fontSize: 44 }}>🧭</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, marginTop: 10, color: "#6B6459" }}>Your learning canvas fills in as Jarvis teaches.</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>Say hello, or tell Jarvis what you&apos;d like to learn.</div>
        </div>
      )}

      <TeacherContent items={teacherContent} filter="text-image" />
      <UsefulResources images={topicImages} />
    </div>
  );
}

/* ===== FROM YOUR TEACHER ===== */
function safeHttpUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
}

type TeacherContentFilter = "text-image" | "video-only";

function TeacherContent({ items, filter }: { items: TeacherContentItem[]; filter: TeacherContentFilter }) {
  const shown = items.filter((c) =>
    filter === "video-only"
      ? c.content_type === "video"
      : c.content_type === "text" || c.content_type === "image"
  );
  if (!shown.length) return null;
  const heading = filter === "video-only" ? "📹 From your teacher" : "🎓 From your teacher";
  return (
    <div style={{ marginTop: 28, borderTop: "1px solid #E7E1D6", paddingTop: 20 }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, color: "#4C43D9", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".06em" }}>{heading}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((c) => {
          if (c.content_type === "image") {
            const src = safeHttpUrl(c.content);
            if (!src) return null;
            return (
              <div key={c.id} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #E7E1D6", background: "#fff" }}>
                <img src={src} alt={c.title} style={{ width: "100%", maxHeight: 340, objectFit: "cover", display: "block" }} />
                <div style={{ padding: "10px 14px", fontSize: 14, fontWeight: 600, color: "#23201B" }}>{c.title}</div>
              </div>
            );
          }
          if (c.content_type === "video") {
            const href = safeHttpUrl(c.content);
            if (!href) return null;
            return (
              <a key={c.id} href={href} target="_blank" rel="noreferrer noopener" style={{ display: "block", background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: "18px 20px", textDecoration: "none" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FDECEA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flex: "0 0 48px" }}>▶</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#23201B", lineHeight: 1.3 }}>{c.title}</div>
                    <div style={{ fontSize: 13, color: "#4A453C", marginTop: 6, lineHeight: 1.45, wordBreak: "break-all" }}>{c.content}</div>
                    <div style={{ display: "inline-block", marginTop: 8, background: "#F3F1FB", color: "#4C43D9", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>👩‍🏫 Teacher recommended</div>
                  </div>
                  <div style={{ color: "#C0392B", fontSize: 18, flex: "0 0 18px" }}>↗</div>
                </div>
              </a>
            );
          }
          return (
            <div key={c.id} style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#23201B", marginBottom: 6 }}>{c.title}</div>
              <div style={{ fontSize: 14, color: "#4A453C", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.content}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== QUIZ TAB ===== */
function QuizTab({ quizData, quizState, quizLoading, generateQuiz, answerQuiz, topicImages, teacherContent }: {
  quizData: QuizItem[]; quizState: Record<number, { answer: string; correct: boolean }>;
  quizLoading: boolean; generateQuiz: () => void; answerQuiz: (qi: number, answer: string) => void; topicImages: TopicImage[];
  teacherContent: TeacherContentItem[];
}) {
  const score = Object.values(quizState).filter((x) => x.correct).length;
  const answered = Object.keys(quizState).length;
  const scoreBar = quizData.length ? Math.round((answered / quizData.length) * 100) : 0;
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader title="Chapter Quiz" subtitle="IB MYP-style questions — recall, application, analysis" btnLabel={quizLoading ? "Generating…" : quizData.length ? "Regenerate" : "Generate Quiz"} btnColor="#4C43D9" onClick={generateQuiz} />
      {quizData.length > 0 && (
        <>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 16, padding: "14px 20px", marginBottom: 18, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, color: "#4C43D9" }}>{score}/{answered}</div><div style={{ fontSize: 12, color: "#8A8172" }}>answered correct</div></div>
            <div style={{ flex: 1, height: 10, background: "#EEE9DF", borderRadius: 6, overflow: "hidden" }}><div style={{ height: "100%", background: "#2E9E6B", borderRadius: 6, width: `${scoreBar}%` }} /></div>
          </div>
          <TeacherContent items={teacherContent} filter="text-image" />
          {quizData.map((q, i) => {
            const st = quizState[i];
            return (
              <div key={i} style={{ background: st ? (st.correct ? "#E4F3EC" : "#FDECEA") : "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22, marginBottom: 14, animation: "jfade .3s ease" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                  <span style={{ fontSize: 16, color: st ? (st.correct ? "#2E9E6B" : "#C0392B") : "#8A8172", fontWeight: 800, minWidth: 20 }}>{st ? (st.correct ? "✓" : "✗") : ""}</span>
                  <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }}>{q.question}</div>
                </div>
                {q.type === "mcq" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(q.options || []).map((o, oi) => <button key={oi} onClick={() => answerQuiz(i, o)} style={{ background: "#F6F3EC", border: "1px solid #E7E1D6", borderRadius: 12, padding: "11px 13px", textAlign: "left", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>{o}</button>)}
                  </div>
                )}
                {st && <div style={{ marginTop: 12, padding: "12px 14px", background: "rgba(0,0,0,.04)", borderRadius: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#4C43D9" }}>Correct answer: {q.answer}</div><div style={{ fontSize: 13, color: "#4A453C", marginTop: 4, lineHeight: 1.5 }}>{q.explanation}</div></div>}
              </div>
            );
          })}
        </>
      )}
      {quizLoading && <Loading emoji="📝" text="Generating IB-style questions…" />}
      <UsefulResources images={topicImages} />
    </div>
  );
}

/* ===== FLASHCARDS TAB ===== */
function FlashcardsTab({ flashcards, fcIndex, fcFlipped, fcLoading, generate, flip, next, prev, topicImages, teacherContent }: {
  flashcards: Flashcard[]; fcIndex: number; fcFlipped: boolean; fcLoading: boolean;
  generate: () => void; flip: () => void; next: () => void; prev: () => void; topicImages: TopicImage[];
  teacherContent: TeacherContentItem[];
}) {
  const card = flashcards[fcIndex];
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader title="Flashcards" subtitle="Tap to flip — key terms, definitions, IB links" btnLabel={fcLoading ? "Generating…" : flashcards.length ? "Regenerate" : "Generate Flashcards"} btnColor="#4C43D9" onClick={generate} />
      {flashcards.length > 0 && card && (
        <>
          <div style={{ textAlign: "center", fontSize: 13, color: "#8A8172", marginBottom: 14 }}>Card {fcIndex + 1} of {flashcards.length}</div>
          <div onClick={flip} style={{ background: "linear-gradient(150deg,#4C43D9,#6B62F5)", borderRadius: 28, minHeight: 220, padding: "36px 32px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", cursor: "pointer", boxShadow: "0 20px 50px -20px rgba(76,67,217,.6)", marginBottom: 18, animation: "jfade .3s ease" }}>
            <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.7)", marginBottom: 12, fontWeight: 700 }}>{fcFlipped ? "Definition" : "Term"} · tap to flip</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 24, color: "#fff", textAlign: "center", lineHeight: 1.3 }}>{fcFlipped ? card.definition : card.term}</div>
            {fcFlipped && (<><div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.25)", fontSize: 14, color: "rgba(255,255,255,.85)", textAlign: "center" }}>📌 {card.example}</div><div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,.65)" }}>IB link: {card.ib_link}</div></>)}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={prev} style={fcNavBtn}>←</button>
            <button onClick={flip} style={{ background: "#ECEBFB", border: "none", borderRadius: 14, padding: "12px 28px", fontWeight: 700, cursor: "pointer", color: "#4C43D9" }}>Flip</button>
            <button onClick={next} style={fcNavBtn}>→</button>
          </div>
        </>
      )}
      {fcLoading && <Loading emoji="🗂" text="Generating flashcards…" />}
      <TeacherContent items={teacherContent} filter="text-image" />
      <UsefulResources images={topicImages} />
    </div>
  );
}
const fcNavBtn: React.CSSProperties = { background: "#fff", border: "1px solid #E7E1D6", borderRadius: 14, padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: 18 };

/* ===== VIDEOS TAB ===== */
function VideosTab({ videos, loading, generate, topicImages, teacherContent }: { videos: import("@/lib/types").VideoItem[]; loading: boolean; generate: () => void; topicImages: TopicImage[]; teacherContent: TeacherContentItem[] }) {
  const ytUrl = (v: import("@/lib/types").VideoItem) => {
    if (v.video_id) return `https://www.youtube.com/watch?v=${v.video_id}${v.timestamp_seconds ? "&t=" + v.timestamp_seconds : ""}`;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(v.search_query || v.title)}`;
  };
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader title="Explanatory Videos" subtitle="Curated YouTube resources — concept-specific, Grade 7 IB level" btnLabel={loading ? "Finding…" : videos.length ? "Refresh" : "Find Videos"} btnColor="#C0392B" onClick={generate} />
      <TeacherContent items={teacherContent} filter="video-only" />
      {videos.map((v, i) => (
        <a key={i} href={ytUrl(v)} target="_blank" rel="noreferrer" style={{ display: "block", background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: "18px 20px", marginBottom: 12, textDecoration: "none", animation: "jfade .3s ease" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FDECEA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flex: "0 0 48px" }}>▶</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#23201B", lineHeight: 1.3 }}>{v.title}</div>
              <div style={{ fontSize: 12, color: "#8A8172", marginTop: 2 }}>{[v.channel, v.timestamp_label].filter(Boolean).join(" · ⏱ ")}</div>
              <div style={{ fontSize: 13, color: "#4A453C", marginTop: 6, lineHeight: 1.45 }}>{v.reason}</div>
              {v.concept_covered && <div style={{ display: "inline-block", marginTop: 8, background: "#FBE9DC", color: "#B5561F", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>{v.concept_covered}</div>}
            </div>
            <div style={{ color: "#C0392B", fontSize: 18, flex: "0 0 18px" }}>↗</div>
          </div>
        </a>
      ))}
      {loading && <Loading emoji="▶" text="Finding the best videos…" />}
      <UsefulResources images={topicImages} />
    </div>
  );
}

/* ===== MIND MAP TAB ===== */
function MindMapTab({ mindMap, loading, generate, topicImages, teacherContent }: { mindMap: MindMap | null; loading: boolean; generate: () => void; topicImages: TopicImage[]; teacherContent: TeacherContentItem[] }) {
  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <ToolHeader title="Mind Map" subtitle="Full conceptual landscape of this topic" btnLabel={loading ? "Building…" : mindMap ? "Rebuild" : "Build Mind Map"} btnColor="#7A5AC2" onClick={generate} />
      {mindMap && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{ background: "linear-gradient(150deg,#23201B,#3A362E)", color: "#fff", borderRadius: 24, padding: "18px 36px", fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, boxShadow: "0 12px 30px -12px rgba(0,0,0,.5)" }}>{mindMap.center}</div>
          <div style={{ width: 2, height: 20, background: "#CFC7B8" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", width: "100%" }}>
            {mindMap.branches.map((b, i) => (
              <div key={i} style={{ background: "#fff", border: `2px solid ${b.color || "#4C43D9"}`, borderRadius: 20, padding: "16px 18px", minWidth: 180, maxWidth: 220, flex: 1, animation: "jfade .4s ease" }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: b.color || "#4C43D9", marginBottom: 10, borderBottom: "1px solid #F1ECE2", paddingBottom: 8 }}>{b.label}</div>
                {b.children.map((c, ci) => <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, marginBottom: 6, lineHeight: 1.35 }}><span style={{ color: b.color || "#4C43D9", fontWeight: 700, flex: "0 0 8px", marginTop: 2 }}>•</span>{c}</div>)}
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && <Loading emoji="🕸" text="Building concept map…" />}
      <TeacherContent items={teacherContent} filter="text-image" />
      <UsefulResources images={topicImages} />
    </div>
  );
}

/* ===== SHARED ===== */
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 20, padding: 24, marginBottom: 16, animation: "jfade .4s ease" }}>{children}</div>;
}
function CmGroup({ title, titleColor, children }: { title: string; titleColor: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 12, fontWeight: 800, color: titleColor, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 }}>{title}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div></div>;
}
function IbCell({ label, value, color }: { label: string; value: string; color: string }) {
  return <div><div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div><div style={{ fontWeight: 700, fontSize: 16, marginTop: 3, color }}>{value}</div></div>;
}
function ReinfCell({ bg, color, label, text }: { bg: string; color: string; label: string; text: string }) {
  return <div style={{ background: bg, borderRadius: 12, padding: 13 }}><div style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", marginBottom: 3 }}>{label}</div><div style={{ fontSize: 14 }}>{text}</div></div>;
}
function ToolHeader({ title, subtitle, btnLabel, btnColor, onClick }: { title: string; subtitle: string; btnLabel: string; btnColor: string; onClick: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{title}</div><div style={{ fontSize: 13, color: "#8A8172" }}>{subtitle}</div></div>
      <button onClick={onClick} style={{ background: btnColor, color: "#fff", border: "none", borderRadius: 14, padding: "12px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{btnLabel}</button>
    </div>
  );
}
function Loading({ emoji, text }: { emoji: string; text: string }) {
  return <div style={{ textAlign: "center", padding: 50, color: "#8A8172" }}><div style={{ fontSize: 36, animation: "jpulse 1.2s infinite" }}>{emoji}</div><div style={{ marginTop: 10, fontWeight: 600 }}>{text}</div></div>;
}
