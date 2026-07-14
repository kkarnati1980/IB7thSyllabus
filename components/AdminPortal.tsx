"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/types";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
type TabKey = "users" | "audit" | "config" | "grades" | "images";
type AuditRow = { action: string; detail: string; at: string };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "grade_teacher", label: "Grade teacher" },
  { value: "subject_teacher", label: "Subject teacher" },
  { value: "guardian", label: "Guardian" },
  { value: "admin", label: "Admin" },
];

export default function AdminPortal({
  admin,
  initialUsers,
  initialLog,
}: {
  admin: { id: string; name: string; email: string };
  initialUsers: PublicUser[];
  initialLog: AuditRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("users");
  const [users, setUsers] = useState<PublicUser[]>(initialUsers);
  const [log, setLog] = useState<AuditRow[]>(initialLog);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("student");
  const [newGuardianStudent, setNewGuardianStudent] = useState("");
  const [newSubjects, setNewSubjects] = useState<string[]>([]);
  const [newError, setNewError] = useState("");
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [newGrade, setNewGrade] = useState("");
  const [availableGrades, setAvailableGrades] = useState<{ id: string; grade: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/school?type=subjects")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((j) => setAvailableSubjects((j.subjects ?? []).map((s: { short_name: string }) => s.short_name)))
      .catch(() => {});
    fetch("/api/admin/school?type=grades")
      .then((r) => (r.ok ? r.json() : { grades: [] }))
      .then((j) => setAvailableGrades(j.grades ?? []))
      .catch(() => {});
  }, []);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("student");
  const [editPass, setEditPass] = useState("");
  const [editError, setEditError] = useState("");

  async function refreshAudit() {
    const res = await fetch("/api/admin/audit");
    if (res.ok) setLog((await res.json()).log);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  async function createUser() {
    if (!newName || !newEmail || !newPass) { setNewError("All fields required."); return; }
    if (newRole === "guardian" && !newGuardianStudent) { setNewError("Pick the student this guardian belongs to."); return; }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName, email: newEmail, password: newPass, role: newRole,
        standaloneGradeId: newRole === "student" ? newGrade || null : null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setNewError(j.error || "Could not create user."); return; }

    // Relational wiring for the new roles goes through the school API.
    let latest = j.users;
    const createdId: string | undefined = j.createdId;
    if (createdId && newRole === "guardian") {
      const r = await fetch("/api/admin/school", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "linkGuardian", guardianId: createdId, studentId: newGuardianStudent }),
      });
      if (r.ok) latest = (await r.json()).users;
    }
    if (createdId && newRole === "subject_teacher" && newSubjects.length) {
      const r = await fetch("/api/admin/school", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assignSubjects", teacherId: createdId, subjects: newSubjects }),
      });
      if (r.ok) latest = (await r.json()).users;
    }

    setUsers(latest);
    setNewName(""); setNewEmail(""); setNewPass(""); setNewRole("student");
    setNewGuardianStudent(""); setNewSubjects([]); setNewGrade(""); setNewError("");
    refreshAudit();
  }

  async function toggleSchool(u: PublicUser) {
    const res = await fetch("/api/admin/school", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: u.linkedToSchool ? "unlink" : "link", studentId: u.id }),
    });
    if (res.ok) { setUsers((await res.json()).users); refreshAudit(); }
  }

  async function toggleUser(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle" }) });
    if (res.ok) { setUsers((await res.json()).users); refreshAudit(); }
  }

  function startEdit(u: PublicUser) { setEditId(u.id); setEditName(u.name); setEditEmail(u.email); setEditRole(u.role); setEditPass(""); setEditError(""); }

  async function saveEdit() {
    if (!editId) return;
    if (!editName.trim() || !editEmail.trim()) { setEditError("Name and email required."); return; }
    const res = await fetch(`/api/admin/users/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName, email: editEmail, role: editRole, password: editPass }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setEditError(j.error || "Could not save."); return; }
    setUsers(j.users); setEditId(null); setEditError(""); refreshAudit();
  }

  async function deleteUser(id: string) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) { setUsers((await res.json()).users); if (editId === id) setEditId(null); refreshAudit(); }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 18px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
    borderBottom: `3px solid ${active ? "#4C43D9" : "transparent"}`, background: "transparent",
    color: active ? "#4C43D9" : "#8A8172", whiteSpace: "nowrap",
  });

  const studentCount = users.filter((u) => u.role === "student").length;
  const activeCount = users.filter((u) => u.active).length;

  return (
    <div style={{ minHeight: "100vh", background: "#EFEAE0", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#23201B", color: "#fff", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(150deg,#6B62F5,#4C43D9)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>J</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>Jarvis Admin Portal</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Logged in as {admin.email}</div>
        </div>
        <button onClick={logout} style={{ background: "#C0392B", border: "none", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Logout</button>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, padding: "24px 32px 0", flexWrap: "wrap" }}>
        <StatCard value={studentCount} label="Student accounts" color="#4C43D9" />
        <StatCard value={activeCount} label="Active users" color="#2E9E6B" />
        <div style={{ background: "#4C43D9", borderRadius: 16, padding: "18px 24px", minWidth: 160, color: "#fff" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>SOC2 Controls</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>scrypt hashing · Audit log · Session mgmt · Role-based access</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "20px 32px 0", borderBottom: "1px solid #E7E1D6", background: "#EFEAE0", marginTop: 16, overflowX: "auto", gap: 0 }}>
        <button onClick={() => setTab("users")} style={tabStyle(tab === "users")}>👥 Users</button>
        <button onClick={() => { setTab("audit"); refreshAudit(); }} style={tabStyle(tab === "audit")}>📋 Audit Log</button>
        <button onClick={() => setTab("config")} style={tabStyle(tab === "config")}>⚙️ Config & API Keys</button>
        <button onClick={() => setTab("grades")} style={tabStyle(tab === "grades")}>📚 Grades & KB</button>
        <button onClick={() => setTab("images")} style={tabStyle(tab === "images")}>🖼 Topic Images</button>
      </div>

      {/* Users Tab */}
      {tab === "users" && (
        <div style={{ padding: "24px 32px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>All users</div>
            {users.map((u) => (
              <div key={u.id} style={{ borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: "#ECEBFB", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: DISPLAY, color: "#4C43D9", fontSize: 16, flex: "0 0 38px" }}>{(u.name || "?")[0].toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: "#8A8172" }}>{u.email} · {u.role}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: u.active ? "#2E9E6B" : "#C0392B", minWidth: 48 }}>{u.active ? "Active" : "Disabled"}</div>
                  <div style={{ fontSize: 12, color: "#A79E8E", minWidth: 80 }}>{u.createdAt.slice(0, 10)}</div>
                  {u.role === "student" ? (
                    <button onClick={() => toggleSchool(u)} title={u.linkedToSchool ? "Unlink from school" : "Link to school"} style={{ background: u.linkedToSchool ? "#E4F3EC" : "#F6F3EC", border: "1px solid #E7E1D6", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: u.linkedToSchool ? "#1E7A50" : "#8A8172", minWidth: 96 }}>{u.linkedToSchool ? "🏫 Linked" : "Link school"}</button>
                  ) : (
                    <div style={{ minWidth: 96 }} />
                  )}
                  <button onClick={() => toggleUser(u.id)} style={{ background: "#F6F3EC", border: "1px solid #E7E1D6", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: u.active ? "#E8823A" : "#2E9E6B" }}>{u.active ? "Disable" : "Enable"}</button>
                  <button onClick={() => startEdit(u)} style={{ background: "#ECEBFB", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#4C43D9" }}>Edit</button>
                  <button onClick={() => deleteUser(u.id)} style={{ background: "#FDECEA", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#C0392B" }}>Delete</button>
                </div>
                {editId === u.id && (
                  <div style={{ background: "#F6F3EC", borderTop: "1px solid #EEE9DF", padding: "18px 20px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                    <EditField label="Name"><input value={editName} onChange={(e) => setEditName(e.target.value)} style={editInput} /></EditField>
                    <EditField label="Email / username"><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={editInput} /></EditField>
                    <EditField label="Role"><select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={editInput}>{ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></EditField>
                    <EditField label="New password (leave blank to keep)"><input value={editPass} onChange={(e) => setEditPass(e.target.value)} type="password" placeholder="••••••••" style={editInput} /></EditField>
                    <div style={{ gridColumn: "2 / 4" }}>
                      {editError && <div style={{ background: "#FDECEA", color: "#C0392B", fontSize: 12, fontWeight: 600, padding: "7px 10px", borderRadius: 8, marginBottom: 8 }}>{editError}</div>}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => setEditId(null)} style={{ background: "#fff", border: "1px solid #E0D9CC", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#5A5347" }}>Cancel</button>
                        <button onClick={saveEdit} style={{ background: "#4C43D9", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#fff" }}>Save changes</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Create account</div>
            {newError && <div style={{ background: "#FDECEA", color: "#C0392B", fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, marginBottom: 12 }}>{newError}</div>}
            <label style={smallLabel}>Full name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Student Name" style={panelInput} />
            <label style={smallLabel}>Email / username</label>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="student@school.edu" style={panelInput} />
            <label style={smallLabel}>Password</label>
            <input value={newPass} onChange={(e) => setNewPass(e.target.value)} type="password" placeholder="••••••••" style={panelInput} />
            <label style={smallLabel}>Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ ...panelInput, background: "#fff" }}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>

            {newRole === "student" && (
              <>
                <label style={smallLabel}>Grade (standalone students)</label>
                <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={{ ...panelInput, background: "#fff" }}>
                  <option value="">— Choose a grade —</option>
                  {availableGrades.map((g) => (
                    <option key={g.id} value={g.id}>Grade {g.grade}</option>
                  ))}
                </select>
              </>
            )}

            {newRole === "guardian" && (
              <>
                <label style={smallLabel}>Linked student</label>
                <select value={newGuardianStudent} onChange={(e) => setNewGuardianStudent(e.target.value)} style={{ ...panelInput, background: "#fff" }}>
                  <option value="">— Choose a student —</option>
                  {users.filter((u) => u.role === "student").map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </>
            )}

            {newRole === "subject_teacher" && (
              <>
                <label style={smallLabel}>Subjects taught</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {availableSubjects.length === 0 && (
                    <span style={{ fontSize: 12, color: "#8A8172" }}>Loading subjects…</span>
                  )}
                  {availableSubjects.map((s) => {
                    const on = newSubjects.includes(s);
                    return (
                      <button key={s} type="button"
                        onClick={() => setNewSubjects((prev) => on ? prev.filter((x) => x !== s) : [...prev, s])}
                        style={{ border: `1px solid ${on ? "#4C43D9" : "#E0D9CC"}`, background: on ? "#ECEBFB" : "#fff", color: on ? "#4C43D9" : "#5A5347", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        {on ? "✓ " : ""}{s}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <button onClick={createUser} style={{ width: "100%", background: "#4C43D9", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Create user</button>
          </div>
        </div>
      )}

      {/* Audit Tab */}
      {tab === "audit" && (
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>Security audit log</div>
              <div style={{ fontSize: 12, color: "#8A8172" }}>Last 50 events · All times UTC</div>
            </div>
            {log.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px", borderBottom: "1px solid #F5F0E8", alignItems: "flex-start" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: l.action.includes("FAIL") || l.action.includes("DELETE") ? "#C0392B" : l.action.includes("LOGIN") ? "#2E9E6B" : "#4C43D9", minWidth: 110, paddingTop: 1 }}>{l.action}</span>
                <span style={{ fontSize: 13, flex: 1, color: "#4A453C" }}>{l.detail}</span>
                <span style={{ fontSize: 11, color: "#A79E8E", minWidth: 140, textAlign: "right" }}>{l.at.replace("T", " ").slice(0, 19)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "config" && <ConfigTab />}
      {tab === "grades" && <GradesKbTab />}
      {tab === "images" && <ImagesTab />}
    </div>
  );
}

/* ===== CONFIG TAB (dynamic LLM manager) ===== */
type LlmConfig = { purpose: string; provider: string; modelName: string; apiKeyMasked: string; hasKey: boolean; baseUrl?: string; active: boolean; updatedAt: string };

const PURPOSES: { value: string; label: string; desc: string }[] = [
  { value: "chat", label: "Chat", desc: "AI Tutor & content generation (Jarvis conversations, quiz, flashcards, mindmap)" },
  { value: "image_generation", label: "Image generation", desc: "Topic image generation (DALL-E, Stable Diffusion, etc.)" },
  { value: "voice_tts", label: "Voice / TTS", desc: "Text-to-speech voice for Jarvis (ElevenLabs, OpenAI TTS, etc.)" },
  { value: "moderation", label: "Moderation", desc: "Content moderation before teacher content is saved" },
];

// provider values stored simple/lowercased; label is for display
const PROVIDER_MODELS: Record<string, { provider: string; label: string; models: string[] }[]> = {
  chat: [
    { provider: "anthropic", label: "Anthropic", models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
    { provider: "openai", label: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"] },
    { provider: "google", label: "Google", models: ["gemini-1.5-pro", "gemini-1.5-flash"] },
  ],
  image_generation: [
    { provider: "openai", label: "OpenAI", models: ["gpt-image-1", "dall-e-3", "dall-e-2"] },
    { provider: "stability", label: "Stability AI", models: ["stable-diffusion-xl-1024-v1-0"] },
    { provider: "google", label: "Google", models: ["imagen-3.0-generate-001"] },
  ],
  voice_tts: [
    { provider: "elevenlabs", label: "ElevenLabs", models: ["eleven_turbo_v2", "eleven_multilingual_v2", "eleven_monolingual_v1"] },
    { provider: "openai", label: "OpenAI", models: ["tts-1", "tts-1-hd"] },
    { provider: "google", label: "Google", models: ["google-tts-standard", "google-tts-wavenet"] },
  ],
  moderation: [
    { provider: "anthropic", label: "Anthropic", models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"] },
    { provider: "openai", label: "OpenAI", models: ["gpt-4o-mini", "omni-moderation-latest"] },
  ],
};

const SAVED_TEXT = "already saved — paste new key to update";
const providerLabel = (p: string) => {
  for (const list of Object.values(PROVIDER_MODELS)) {
    const hit = list.find((x) => x.provider === p);
    if (hit) return hit.label;
  }
  return p;
};

function ConfigTab() {
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [loaded, setLoaded] = useState(false);

  // edit panel state
  const [purpose, setPurpose] = useState("chat");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const [voices, setVoices] = useState<{ id: string; name: string; category: string; gender: string }[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  async function loadConfigs() {
    const res = await fetch("/api/admin/llm-config");
    const j = await res.json().catch(() => ({ configs: [] }));
    setConfigs(j.configs || []);
    setLoaded(true);
  }
  useEffect(() => { loadConfigs(); }, []);

  const providersFor = PROVIDER_MODELS[purpose] || [];
  const modelsFor = providersFor.find((p) => p.provider === provider)?.models || [];

  // when purpose changes, default provider/model + pull any saved config for that purpose
  function selectPurpose(p: string, existing?: LlmConfig) {
    setPurpose(p);
    setTestMsg(null); setVoices([]); setVoiceError(""); setSaved(false);
    const list = PROVIDER_MODELS[p] || [];
    const prov = existing?.provider && list.some((x) => x.provider === existing.provider) ? existing.provider : (list[0]?.provider || "");
    setProvider(prov);
    const models = list.find((x) => x.provider === prov)?.models || [];
    setModel(existing?.modelName && models.includes(existing.modelName) ? existing.modelName : (models[0] || ""));
    setBaseUrl(existing?.baseUrl || "");
    setHasKey(!!existing?.hasKey);
    setApiKey(existing?.hasKey ? SAVED_TEXT : "");
  }

  function changeProvider(prov: string) {
    setProvider(prov);
    const models = (PROVIDER_MODELS[purpose] || []).find((x) => x.provider === prov)?.models || [];
    setModel(models[0] || "");
    setTestMsg(null); setVoices([]); setVoiceError("");
  }

  async function save() {
    setSaving(true); setSaved(false);
    // send apiKey only when the admin typed a new one; empty string preserves the saved key
    const typedKey = apiKey && !apiKey.startsWith("already saved") ? apiKey.trim() : "";
    await fetch("/api/admin/llm-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, provider, modelName: model, apiKey: typedKey, baseUrl: baseUrl.trim() || undefined }),
    });
    setSaving(false); setSaved(true);
    setApiKey(SAVED_TEXT); setHasKey(true);
    await loadConfigs();
    setTimeout(() => setSaved(false), 3000);
  }

  async function testConnection() {
    setTesting(true); setTestMsg(null);
    const res = await fetch("/api/admin/llm-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test", purpose }),
    });
    const j = await res.json().catch(() => ({ ok: false, message: "Test failed." }));
    setTestMsg({ ok: !!j.ok, message: j.message || (j.ok ? "OK" : "Test failed.") });
    setTesting(false);
  }

  async function testVoices() {
    setVoicesLoading(true); setVoiceError(""); setVoices([]);
    const res = await fetch("/api/elevenlabs/voices");
    const j = await res.json().catch(() => ({}));
    if (j.voices?.length) setVoices(j.voices);
    else setVoiceError(j.error || "No voices returned. Check the API key is saved correctly.");
    setVoicesLoading(false);
  }

  async function removeConfig(p: string) {
    if (!window.confirm(`Remove the ${p} LLM configuration?`)) return;
    await fetch(`/api/admin/llm-config?purpose=${encodeURIComponent(p)}`, { method: "DELETE" });
    await loadConfigs();
  }

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, color: "#8A8172", textTransform: "uppercase", letterSpacing: ".05em", padding: "10px 14px", borderBottom: "1px solid #E7E1D6" };
  const td: React.CSSProperties = { fontSize: 13, padding: "12px 14px", borderBottom: "1px solid #F5F0E8", verticalAlign: "top" };
  const purposeDesc = PURPOSES.find((p) => p.value === purpose)?.desc || "";

  return (
    <div style={{ padding: "24px 32px" }}>
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, margin: "0 0 6px" }}>Config & API Keys</h2>
      <p style={{ color: "#6B6459", fontSize: 15, margin: "0 0 24px" }}>Configure which LLM provider and model powers each part of Jarvis. Keys are stored securely and never exposed to students.</p>

      {/* Config table */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden", marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Purpose</th>
              <th style={th}>Provider</th>
              <th style={th}>Model</th>
              <th style={th}>Key status</th>
              <th style={th}>Last updated</th>
              <th style={{ ...th, textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {PURPOSES.map((p) => {
              const cfg = configs.find((c) => c.purpose === p.value);
              return (
                <tr key={p.value}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: "#8A8172", maxWidth: 320 }}>{p.desc}</div>
                  </td>
                  <td style={td}>{cfg ? providerLabel(cfg.provider) : <span style={{ color: "#A79E8E" }}>—</span>}</td>
                  <td style={td}>{cfg ? cfg.modelName : <span style={{ color: "#A79E8E" }}>Not configured</span>}</td>
                  <td style={td}>
                    {cfg?.hasKey
                      ? <span style={{ color: "#2E9E6B", fontWeight: 700 }}>✓ {cfg.apiKeyMasked || "saved"}</span>
                      : <span style={{ color: "#C0392B", fontWeight: 700 }}>No key</span>}
                  </td>
                  <td style={{ ...td, color: "#A79E8E", fontSize: 12 }}>{cfg?.updatedAt ? cfg.updatedAt.replace("T", " ").slice(0, 16) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => selectPurpose(p.value, cfg)} style={{ background: "#ECEBFB", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#4C43D9" }}>Edit</button>
                    {cfg && <button onClick={() => removeConfig(p.value)} style={{ background: "#FDECEA", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#C0392B", marginLeft: 6 }}>Delete</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loaded && <div style={{ padding: 16, color: "#8A8172", fontSize: 13 }}>Loading…</div>}
      </div>

      {/* Edit panel */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 24, maxWidth: 760 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Edit configuration</div>
        <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 16px" }}>{purposeDesc}</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={smallLabel}>Purpose</label>
            <select value={purpose} onChange={(e) => selectPurpose(e.target.value, configs.find((c) => c.purpose === e.target.value))} style={{ ...panelInput, background: "#fff", marginBottom: 0 }}>
              {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={smallLabel}>Provider</label>
            <select value={provider} onChange={(e) => changeProvider(e.target.value)} style={{ ...panelInput, background: "#fff", marginBottom: 0 }}>
              {providersFor.map((p) => <option key={p.provider} value={p.provider}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={smallLabel}>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...panelInput, background: "#fff", marginBottom: 0 }}>
              {modelsFor.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <label style={smallLabel}>API key</label>
        <input
          value={apiKey}
          type="password"
          onChange={(e) => setApiKey(e.target.value)}
          onFocus={() => { if (apiKey.startsWith("already saved")) setApiKey(""); }}
          placeholder={hasKey ? SAVED_TEXT : "Paste API key"}
          style={{ ...panelInput, color: apiKey.startsWith("already saved") ? "#2E9E6B" : "#23201B" }}
        />

        <label style={smallLabel}>Base URL (optional)</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://… (leave blank for provider default)" style={panelInput} />

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={save} disabled={saving} style={{ background: saved ? "#2E9E6B" : "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "10px 22px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
          </button>
          <button onClick={testConnection} disabled={testing} style={{ background: "#F1ECE2", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#4C43D9" }}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          {purpose === "voice_tts" && provider === "elevenlabs" && (
            <button onClick={testVoices} disabled={voicesLoading} style={{ background: "#F1ECE2", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#4C43D9" }}>
              {voicesLoading ? "Loading…" : "Test & list voices"}
            </button>
          )}
          {testMsg && <span style={{ color: testMsg.ok ? "#2E9E6B" : "#C0392B", fontSize: 13, fontWeight: 600 }}>{testMsg.ok ? "✓ " : "✗ "}{testMsg.message}</span>}
          {voiceError && <span style={{ color: "#C0392B", fontSize: 13, fontWeight: 600 }}>{voiceError}</span>}
        </div>

        {voices.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {voices.map((v) => (
              <div key={v.id} style={{ background: "#F6F3EC", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                <div style={{ fontWeight: 700 }}>{v.name}</div>
                <div style={{ color: "#8A8172", fontSize: 11 }}>{v.gender} · {v.category}</div>
                <div style={{ fontSize: 10, color: "#A79E8E", marginTop: 2 }}>ID: {v.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== GRADES & KNOWLEDGE BASE TAB ===== */
type Grade = { id: string; grade: string; displayName: string; description: string; schoolId: string; schoolName: string; fileCount: number; studentCount: number };
type KbFile = { id: string; name: string; subject: string; shortName: string; count: number };

function GradesKbTab() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradesError, setGradesError] = useState("");
  const [selected, setSelected] = useState<Grade | null>(null);

  // add-grade form
  const [newDisplay, setNewDisplay] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // inline grade edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editDisplay, setEditDisplay] = useState("");
  const [editDesc, setEditDesc] = useState("");

  async function loadGrades() {
    const res = await fetch("/api/admin/grades");
    const j = await res.json().catch(() => ({ grades: [] }));
    setGrades(j.grades || []);
  }
  useEffect(() => { loadGrades(); }, []);

  // school defaults come from an existing grade, else fall back
  const school = grades[0]
    ? { id: grades[0].schoolId, name: grades[0].schoolName }
    : { id: "school_iish", name: "IISH" };

  async function createGrade() {
    if (!newDisplay.trim() || !newCode.trim()) { setGradesError("Display name and grade code are required."); return; }
    setCreating(true); setGradesError("");
    const res = await fetch("/api/admin/grades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: newCode.trim(), displayName: newDisplay.trim(), description: newDesc.trim(), schoolId: school.id }),
    });
    const j = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) { setGradesError(j.error || "Could not create grade."); return; }
    setNewDisplay(""); setNewCode(""); setNewDesc("");
    loadGrades();
  }

  function startEdit(g: Grade) { setEditId(g.id); setEditDisplay(g.displayName); setEditDesc(g.description); }
  async function saveEdit() {
    if (!editId) return;
    const res = await fetch("/api/admin/grades", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, displayName: editDisplay, description: editDesc }),
    });
    if (res.ok) { setEditId(null); loadGrades(); }
  }

  async function deleteGrade(g: Grade) {
    if (!window.confirm(`Delete ${g.displayName}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/grades?id=${encodeURIComponent(g.id)}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setGradesError(j.error || "Could not delete grade."); return; }
    if (selected?.id === g.id) setSelected(null);
    setGradesError("");
    loadGrades();
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, margin: "0 0 6px" }}>Grades & Knowledge Base</h2>
      <p style={{ color: "#6B6459", fontSize: 15, margin: "0 0 24px" }}>Manage grades and the syllabus knowledge base Jarvis draws on for each grade.</p>

      {gradesError && <div style={{ background: "#FDECEA", color: "#C0392B", fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, marginBottom: 16 }}>{gradesError}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 1fr) minmax(360px, 1.3fr)", gap: 24, alignItems: "start" }}>
        {/* LEFT — grade management */}
        <div>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>Grades</div>
            {grades.length === 0 && <div style={{ padding: 20, color: "#8A8172", fontSize: 13 }}>No grades yet. Add one below.</div>}
            {grades.map((g) => (
              <div key={g.id} style={{ borderBottom: "1px solid #F5F0E8", padding: "16px 20px", background: selected?.id === g.id ? "#F3F1FB" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>{g.displayName}</div>
                    <div style={{ fontSize: 12, color: "#8A8172", marginTop: 2 }}>{g.schoolName} · Grade {g.grade}</div>
                    {editId === g.id ? (
                      <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" style={{ ...panelInput, marginTop: 8, marginBottom: 0, minHeight: 54, resize: "vertical" }} />
                    ) : (
                      g.description && <div style={{ fontSize: 13, color: "#5A5347", marginTop: 6 }}>{g.description}</div>
                    )}
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "#6B6459" }}>
                      <span><strong>{g.studentCount}</strong> students</span>
                      <span><strong>{g.fileCount}</strong> KB files</span>
                    </div>
                  </div>
                </div>
                {editId === g.id && (
                  <div style={{ marginTop: 8 }}>
                    <label style={smallLabel}>Display name</label>
                    <input value={editDisplay} onChange={(e) => setEditDisplay(e.target.value)} style={panelInput} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button onClick={() => setSelected(g)} style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Manage KB</button>
                  {editId === g.id ? (
                    <>
                      <button onClick={saveEdit} style={{ background: "#ECEBFB", color: "#4C43D9", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditId(null)} style={{ background: "#F1ECE2", color: "#5A5347", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(g)} style={{ background: "#ECEBFB", color: "#4C43D9", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                  )}
                  <button
                    onClick={() => deleteGrade(g)}
                    disabled={g.fileCount > 0 || g.studentCount > 0}
                    title={g.fileCount > 0 || g.studentCount > 0 ? "Remove all files and students before deleting" : "Delete grade"}
                    style={{ background: "#FDECEA", color: "#C0392B", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: g.fileCount > 0 || g.studentCount > 0 ? "not-allowed" : "pointer", opacity: g.fileCount > 0 || g.studentCount > 0 ? 0.5 : 1 }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add grade */}
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 14 }}>Add grade</div>
            <label style={smallLabel}>Display name</label>
            <input value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder="Grade 7" style={panelInput} />
            <label style={smallLabel}>Grade code</label>
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="7" style={panelInput} />
            <label style={smallLabel}>Description (optional)</label>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="IB MYP Year 2" style={panelInput} />
            <label style={smallLabel}>School</label>
            <input value={school.name} disabled style={{ ...panelInput, background: "#F6F3EC", color: "#8A8172" }} />
            <button onClick={createGrade} disabled={creating} style={{ width: "100%", background: "#4C43D9", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {creating ? "Creating…" : "Create grade"}
            </button>
          </div>
        </div>

        {/* RIGHT — KB files for selected grade */}
        <div>
          {!selected ? (
            <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 40, textAlign: "center", color: "#8A8172" }}>
              <div style={{ fontSize: 32 }}>📚</div>
              <div style={{ fontWeight: 600, marginTop: 8 }}>Select a grade to manage its knowledge base.</div>
            </div>
          ) : (
            <KbPanel grade={selected} onGradesChanged={loadGrades} />
          )}
        </div>
      </div>
    </div>
  );
}

function KbPanel({ grade, onGradesChanged }: { grade: Grade; onGradesChanged: () => void }) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);

  // auto-source modal
  const [autoFor, setAutoFor] = useState<KbFile | null>(null);
  const [optImages, setOptImages] = useState(true);
  const [optVideos, setOptVideos] = useState(true);
  const [optAiImages, setOptAiImages] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResult, setAutoResult] = useState<{ imagesFound: number; videosFound: number; headingsProcessed: number; truncated: boolean } | null>(null);

  async function loadFiles() {
    setLoading(true);
    const res = await fetch(`/api/admin/kb?gradeId=${encodeURIComponent(grade.id)}`);
    const j = await res.json().catch(() => ({ files: [] }));
    setFiles(j.files || []);
    setLoading(false);
  }
  useEffect(() => { loadFiles(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [grade.id]);

  async function uploadPdf() {
    if (!pdf) { setError("Choose a PDF first."); return; }
    setUploading(true); setError(""); setUploadStatus("Converting to knowledge base…");
    const fd = new FormData();
    fd.append("file", pdf);
    fd.append("gradeId", grade.id);
    const res = await fetch("/api/admin/kb", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({ status: "failed", error: "Upload failed." }));
    setUploading(false);
    if (!res.ok || j.status === "failed") { setError(j.error || "Upload failed."); setUploadStatus(""); return; }
    setUploadStatus(`✓ ${j.fileName || pdf.name} — ${j.chunksCreated ?? 0} sections created.`);
    setPdf(null);
    loadFiles(); onGradesChanged();
  }

  async function uploadMd(file: File) {
    setUploading(true); setError(""); setUploadStatus("Uploading markdown…");
    const text = await file.text();
    const res = await fetch("/api/syllabus", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ name: file.name, text }], gradeLevelId: grade.id }),
    });
    setUploading(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Markdown upload failed."); setUploadStatus(""); return; }
    setUploadStatus(`✓ ${file.name} uploaded.`);
    loadFiles(); onGradesChanged();
  }

  async function deleteFile(id: string) {
    if (!window.confirm("Delete this knowledge base file?")) return;
    await fetch(`/api/admin/kb?fileId=${encodeURIComponent(id)}`, { method: "DELETE" });
    loadFiles(); onGradesChanged();
  }

  async function runAutoSource() {
    if (!autoFor) return;
    setAutoRunning(true); setAutoResult(null);
    const res = await fetch("/api/admin/kb/auto-source", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: autoFor.id, options: { images: optImages, videos: optVideos, aiImages: optAiImages } }),
    });
    const j = await res.json().catch(() => ({ imagesFound: 0, videosFound: 0, headingsProcessed: 0, truncated: false }));
    setAutoResult(j);
    setAutoRunning(false);
  }

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, color: "#8A8172", textTransform: "uppercase", letterSpacing: ".05em", padding: "10px 14px", borderBottom: "1px solid #E7E1D6" };
  const td: React.CSSProperties = { fontSize: 13, padding: "12px 14px", borderBottom: "1px solid #F5F0E8", verticalAlign: "top" };

  return (
    <div>
      <div style={{ background: "#F3F1FB", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 14 }}>
        <strong>Knowledge base for:</strong> {grade.displayName} <span style={{ color: "#8A8172" }}>({grade.schoolName})</span>
      </div>

      {/* Upload card */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22, marginBottom: 20 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📄 Upload Syllabus PDF</div>
        <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 14px" }}>Jarvis will convert it to a structured knowledge base automatically using the configured Chat LLM.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="file" accept=".pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
          <button onClick={uploadPdf} disabled={uploading || !pdf} style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: uploading || !pdf ? "not-allowed" : "pointer", fontSize: 13, opacity: uploading || !pdf ? 0.6 : 1 }}>
            {uploading ? "Working…" : "Upload & Convert"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#A79E8E", marginTop: 8 }}>Max 10MB per file.</div>

        <div style={{ borderTop: "1px solid #F1ECE2", marginTop: 16, paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5A5347", marginBottom: 8 }}>Or upload a .md file directly</div>
          <input type="file" accept=".md" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMd(f); e.target.value = ""; }} style={{ fontSize: 13 }} />
        </div>

        {uploadStatus && <div style={{ marginTop: 12, color: "#1E7A50", fontSize: 13, fontWeight: 600 }}>{uploading ? "⏳ " : ""}{uploadStatus}</div>}
        {error && <div style={{ marginTop: 12, color: "#C0392B", fontSize: 13, fontWeight: 600, background: "#FDECEA", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
      </div>

      {/* Files table */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>Knowledge base files</div>
        {loading && <div style={{ padding: 20, color: "#8A8172", fontSize: 13 }}>Loading…</div>}
        {!loading && files.length === 0 && <div style={{ padding: 20, color: "#8A8172", fontSize: 13 }}>No files yet for this grade.</div>}
        {files.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={th}>File</th>
                  <th style={th}>Short name</th>
                  <th style={th}>Sections</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "#8A8172" }}>{f.subject}</div>
                    </td>
                    <td style={td}>{f.shortName}</td>
                    <td style={td}>{f.count}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => { setAutoFor(f); setAutoResult(null); }} style={{ background: "#ECEBFB", color: "#4C43D9", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Auto-source resources</button>
                      <button onClick={() => deleteFile(f.id)} style={{ background: "#FDECEA", color: "#C0392B", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Auto-source modal */}
      {autoFor && (
        <div onClick={() => setAutoFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(35,32,27,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 24, maxWidth: 420, width: "100%" }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Auto-source resources</div>
            <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 16px" }}>{autoFor.name}</p>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={optImages} onChange={(e) => setOptImages(e.target.checked)} /> Find topic images
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={optVideos} onChange={(e) => setOptVideos(e.target.checked)} /> Find video links
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={optAiImages} onChange={(e) => setOptAiImages(e.target.checked)} /> Generate AI images
            </label>
            {autoResult && (
              <div style={{ background: "#E4F3EC", color: "#1E7A50", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                {autoResult.imagesFound} images · {autoResult.videosFound} videos · {autoResult.headingsProcessed} headings processed{autoResult.truncated ? " · truncated" : ""}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setAutoFor(null)} style={{ background: "#F1ECE2", color: "#5A5347", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close</button>
              <button onClick={runAutoSource} disabled={autoRunning} style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {autoRunning ? "Running…" : "Run auto-sourcing"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== IMAGES TAB ===== */
type TopicImage = { id: string; image_url: string; thumbnail_url: string; alt_text: string; source: string; status: string };

type SubjectHierarchy = { shortName: string; files: { fileId: string; fileName: string; topics: string[] }[] };

function ImagesTab() {
  const [hierarchy, setHierarchy] = useState<SubjectHierarchy[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [images, setImages] = useState<TopicImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<"web" | "ai" | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualAlt, setManualAlt] = useState("");
  const [error, setError] = useState("");
  const [approving, setApproving] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<{ url: string; alt: string } | null>(null);

  // Load the full Subject → Chapter → Topic hierarchy for the cascade.
  useEffect(() => {
    fetch("/api/admin/topic-picker")
      .then((r) => r.json())
      .then((j) => { if (j.subjects) setHierarchy(j.subjects); });
  }, []);

  const subjectFiles = hierarchy.find((s) => s.shortName === selectedSubject)?.files ?? [];
  const chapterTopics = subjectFiles.find((f) => f.fileId === selectedFileId)?.topics ?? [];
  const selectedFileName = subjectFiles.find((f) => f.fileId === selectedFileId)?.fileName ?? "";
  const ready = !!selectedTopic;

  // Most subjects have a single chapter — auto-select it so Step 3 (topics) shows immediately.
  useEffect(() => {
    const files = hierarchy.find((s) => s.shortName === selectedSubject)?.files ?? [];
    if (selectedSubject && !selectedFileId && files.length === 1) setSelectedFileId(files[0].fileId);
  }, [selectedSubject, selectedFileId, hierarchy]);

  async function loadImages(topic: string, subject: string) {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/images?topicName=${encodeURIComponent(topic)}&subjectName=${encodeURIComponent(subject)}&all=true`);
    const j = await res.json();
    setImages(j.images || []);
    setLoading(false);
  }

  function chooseTopic(topic: string) {
    setSelectedTopic(topic);
    if (topic) loadImages(topic, selectedSubject);
    else setImages([]);
  }

  async function generate(action: "web" | "ai") {
    if (!ready) { setError("Select a subject, chapter and topic first."); return; }
    setGenerating(action);
    setError("");
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName: selectedTopic, subjectName: selectedSubject, action }),
    });
    const j = await res.json();
    if (!res.ok) { setError(j.error || "Failed"); setGenerating(null); return; }
    setImages(j.images || []);
    setGenerating(null);
  }

  async function saveManual() {
    if (!manualUrl || !ready) { setError("Select a topic and enter a URL."); return; }
    setError("");
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName: selectedTopic, subjectName: selectedSubject, action: "manual", imageUrl: manualUrl, altText: manualAlt || selectedTopic }),
    });
    const j = await res.json();
    if (!res.ok) { setError(j.error || "Failed"); return; }
    setImages(j.images || []);
    setManualUrl(""); setManualAlt("");
  }

  async function setStatus(imageId: string, action: "approve" | "reject") {
    if (!ready) return;
    setApproving(imageId);
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName: selectedTopic, subjectName: selectedSubject, action, imageId }),
    });
    const j = await res.json();
    if (res.ok) setImages(j.images || []);
    setApproving(null);
  }

  async function deleteImage(id: string) {
    await fetch(`/api/images?id=${id}`, { method: "DELETE" });
    setImages((imgs) => imgs.filter((i) => i.id !== id));
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      pending:  { bg: "#FBF4EC", color: "#B5561F", label: "⏳ Pending review" },
      approved: { bg: "#E4F3EC", color: "#1E7A50", label: "✓ Approved — live to students" },
      rejected: { bg: "#FDECEA", color: "#C0392B", label: "✗ Rejected — hidden" },
    };
    const s = map[status] || map.pending;
    return <span style={{ fontSize: 11, background: s.bg, color: s.color, borderRadius: 20, padding: "3px 10px", fontWeight: 700 }}>{s.label}</span>;
  };

  return (
    <div style={{ padding: "24px 32px" }}>
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
            <img
              src={lightboxImg.url}
              alt={lightboxImg.alt}
              style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 12, display: "block" }}
              onError={(e) => { (e.target as HTMLImageElement).src = `https://placehold.co/800x500/23201B/ffffff?text=${encodeURIComponent("Image unavailable")}`; }}
            />
            <div style={{ position: "absolute", bottom: -32, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
              {lightboxImg.alt} · Click anywhere to close
            </div>
            <button
              onClick={() => setLightboxImg(null)}
              style={{ position: "absolute", top: -14, right: -14, background: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontWeight: 800, fontSize: 14, lineHeight: "28px", textAlign: "center" }}
            >✕</button>
          </div>
        </div>
      )}
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, margin: "0 0 6px" }}>Topic Images</h2>
      <p style={{ color: "#6B6459", fontSize: 15, margin: "0 0 6px" }}>Generate images for topics. All images start as <strong>Pending</strong> — you must Approve them before students can see them.</p>
      <p style={{ color: "#C0392B", fontSize: 13, fontWeight: 600, margin: "0 0 24px" }}>⚠ Review all images carefully before approving. Only IB-appropriate, curriculum-relevant content should be shown to students.</p>

      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22, marginBottom: 20 }}>
        {/* Step 1 — Subject */}
        <div style={{ marginBottom: 14 }}>
          <label style={smallLabel}>Step 1 — Subject</label>
          <select
            value={selectedSubject}
            onChange={(e) => { setSelectedSubject(e.target.value); setSelectedFileId(""); setSelectedTopic(""); setImages([]); }}
            style={cascadeSelect}
          >
            <option value="">— Select subject —</option>
            {hierarchy.map((s) => <option key={s.shortName} value={s.shortName}>{s.shortName}</option>)}
          </select>
        </div>

        {/* Step 2 — Chapter */}
        {selectedSubject && (
          <div style={{ marginBottom: 14 }}>
            <label style={smallLabel}>Step 2 — Chapter</label>
            <select
              value={selectedFileId}
              onChange={(e) => {
                const fid = e.target.value;
                setSelectedFileId(fid); setSelectedTopic(""); setImages([]);
                console.log("chapterTopics", subjectFiles.find((f) => f.fileId === fid)?.topics ?? []);
              }}
              style={cascadeSelect}
            >
              <option value="">— Select chapter —</option>
              {subjectFiles.map((f) => (
                <option key={f.fileId} value={f.fileId}>
                  {selectedSubject} — {f.fileName.replace(/\.md$/i, "").replace(/-/g, " ")}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Step 3 — Topic */}
        {selectedFileId && (
          <div style={{ marginBottom: 14 }}>
            <label style={smallLabel}>Step 3 — Topic</label>
            <select value={selectedTopic} onChange={(e) => chooseTopic(e.target.value)} style={cascadeSelect}>
              <option value="">— Select topic —</option>
              {chapterTopics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        {ready && (
          <>
            <div style={{ background: "#F3F1FB", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 14 }}>
              ✓ <strong>{selectedSubject}</strong> → {selectedFileName} → <strong>{selectedTopic}</strong>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <button onClick={() => generate("web")} disabled={generating !== null || !ready}
                style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {generating === "web" ? "Searching…" : "🔍 Find web image"}
              </button>
              <button onClick={() => generate("ai")} disabled={generating !== null || !ready}
                style={{ background: "#2E9E6B", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {generating === "ai" ? "Generating…" : "🎨 Generate AI image (DALL-E)"}
              </button>
            </div>

            <div style={{ borderTop: "1px solid #F1ECE2", paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#5A5347", marginBottom: 10 }}>Or paste a URL manually</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10 }}>
                <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://..." style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
                <input value={manualAlt} onChange={(e) => setManualAlt(e.target.value)} placeholder="Alt text / description" style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
                <button onClick={saveManual} disabled={!ready} style={{ background: "#E8823A", color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Save</button>
              </div>
            </div>
          </>
        )}

        {error && <div style={{ marginTop: 12, color: "#C0392B", fontSize: 13, fontWeight: 600, background: "#FDECEA", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8A8172", fontWeight: 600 }}>Loading images…</div>}

      {!loading && ready && images.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#8A8172" }}>
          <div style={{ fontSize: 32 }}>🖼</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>No images yet for this topic.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Use the buttons above to generate or add images.</div>
        </div>
      )}

      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          {images.map((img) => (
            <div key={img.id} style={{ background: "#fff", border: `2px solid ${img.status === "approved" ? "#BEE3CF" : img.status === "rejected" ? "#F5D5CF" : "#E7E1D6"}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ position: "relative" }}>
                <img src={img.thumbnail_url} alt={img.alt_text}
                  style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }}
                  onError={(e) => {
                    const t = e.target as HTMLImageElement;
                    if (!t.dataset.fallback) {
                      t.dataset.fallback = "1";
                      t.src = img.image_url; // try the full-size URL
                    } else {
                      t.src = `https://placehold.co/400x200/EFEAE0/8A8172?text=${encodeURIComponent(img.alt_text.slice(0, 25))}`;
                    }
                  }} />
                <button
                  onClick={() => setLightboxImg({ url: img.image_url, alt: img.alt_text })}
                  style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  🔍 View full
                </button>
              </div>
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{img.alt_text}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  {statusBadge(img.status)}
                  <span style={{ fontSize: 11, color: "#8A8172" }}>{img.source === "ai" ? "🎨 AI" : img.source === "web" ? "🔍 Web" : "📎 Manual"}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {img.status !== "approved" && (
                    <button onClick={() => setStatus(img.id, "approve")} disabled={approving === img.id}
                      style={{ flex: 1, background: "#E4F3EC", color: "#1E7A50", border: "none", borderRadius: 9, padding: "8px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                      ✓ Approve
                    </button>
                  )}
                  {img.status !== "rejected" && (
                    <button onClick={() => setStatus(img.id, "reject")} disabled={approving === img.id}
                      style={{ flex: 1, background: "#FDECEA", color: "#C0392B", border: "none", borderRadius: 9, padding: "8px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                      ✗ Reject
                    </button>
                  )}
                  <button onClick={() => deleteImage(img.id)}
                    style={{ background: "#F1ECE2", color: "#5A5347", border: "none", borderRadius: 9, padding: "8px 12px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 16, padding: "18px 24px", minWidth: 160 }}>
      <div style={{ fontSize: 28, fontFamily: DISPLAY, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 13, color: "#8A8172" }}>{label}</div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#5A5347", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</label>
      {children}
    </div>
  );
}

const editInput: React.CSSProperties = { width: "100%", border: "1px solid #E0D9CC", borderRadius: 9, padding: "9px 11px", fontSize: 14, background: "#fff" };
const smallLabel: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#5A5347", marginBottom: 6 };
const cascadeSelect: React.CSSProperties = { width: "100%", border: "1px solid #E0D9CC", borderRadius: 10, padding: "11px 13px", fontSize: 14, background: "#fff" };
const panelInput: React.CSSProperties = { width: "100%", border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12 };
