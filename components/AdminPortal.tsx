"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/types";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

type AuditRow = { action: string; detail: string; at: string };
type TabKey = "users" | "audit" | "config" | "images";

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
  const [newError, setNewError] = useState("");

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
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, email: newEmail, password: newPass, role: newRole }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setNewError(j.error || "Could not create user."); return; }
    setUsers(j.users);
    setNewName(""); setNewEmail(""); setNewPass(""); setNewError("");
    refreshAudit();
  }

  async function toggleUser(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    if (res.ok) { setUsers((await res.json()).users); refreshAudit(); }
  }

  function startEdit(u: PublicUser) {
    setEditId(u.id); setEditName(u.name); setEditEmail(u.email);
    setEditRole(u.role); setEditPass(""); setEditError("");
  }

  async function saveEdit() {
    if (!editId) return;
    if (!editName.trim() || !editEmail.trim()) { setEditError("Name and email required."); return; }
    const res = await fetch(`/api/admin/users/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, email: editEmail, role: editRole, password: editPass }),
    });
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
    padding: "10px 18px",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    borderBottom: `3px solid ${active ? "#4C43D9" : "transparent"}`,
    background: "transparent",
    color: active ? "#4C43D9" : "#8A8172",
    whiteSpace: "nowrap",
  });

  const studentCount = users.filter((u) => u.role === "student").length;
  const activeCount = users.filter((u) => u.active).length;

  return (
    <div style={{ minHeight: "100vh", background: "#EFEAE0", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ background: "#23201B", color: "#fff", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(150deg,#6B62F5,#4C43D9)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 18 }}>J</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>Jarvis Admin Portal</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Logged in as {admin.email}</div>
        </div>
        <button onClick={logout} style={{ background: "#C0392B", border: "none", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Logout</button>
      </div>

      {/* stats */}
      <div style={{ display: "flex", gap: 14, padding: "24px 32px 0", flexWrap: "wrap" }}>
        <StatCard value={studentCount} label="Student accounts" color="#4C43D9" />
        <StatCard value={activeCount} label="Active users" color="#2E9E6B" />
        <div style={{ background: "#4C43D9", borderRadius: 16, padding: "18px 24px", minWidth: 160, color: "#fff" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>SOC2 Controls</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>scrypt hashing · Audit log · Session mgmt · Role-based access</div>
        </div>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 0, padding: "20px 32px 0", borderBottom: "1px solid #E7E1D6", background: "#EFEAE0", marginTop: 16, overflowX: "auto" }}>
        <button onClick={() => setTab("users")} style={tabStyle(tab === "users")}>👥 Users</button>
        <button onClick={() => { setTab("audit"); refreshAudit(); }} style={tabStyle(tab === "audit")}>📋 Audit Log</button>
        <button onClick={() => setTab("config")} style={tabStyle(tab === "config")}>⚙️ Config & API Keys</button>
        <button onClick={() => setTab("images")} style={tabStyle(tab === "images")}>🖼 Topic Images</button>
      </div>

      {tab === "users" && (
        <div style={{ padding: "24px 32px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E1D6", fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>All users</div>
            {users.map((u) => (
              <div key={u.id} style={{ borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: "#ECEBFB", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: DISPLAY, color: "#4C43D9", fontSize: 16, flex: "0 0 38px" }}>
                    {(u.name || "?")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: "#8A8172" }}>{u.email} · {u.role}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: u.active ? "#2E9E6B" : "#C0392B", minWidth: 48 }}>{u.active ? "Active" : "Disabled"}</div>
                  <div style={{ fontSize: 12, color: "#A79E8E", minWidth: 80 }}>{u.createdAt.slice(0, 10)}</div>
                  <button onClick={() => toggleUser(u.id)} style={{ background: "#F6F3EC", border: "1px solid #E7E1D6", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: u.active ? "#E8823A" : "#2E9E6B" }}>{u.active ? "Disable" : "Enable"}</button>
                  <button onClick={() => startEdit(u)} style={{ background: "#ECEBFB", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#4C43D9" }}>Edit</button>
                  <button onClick={() => deleteUser(u.id)} style={{ background: "#FDECEA", border: "none", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#C0392B" }}>Delete</button>
                </div>
                {editId === u.id && (
                  <div style={{ background: "#F6F3EC", borderTop: "1px solid #EEE9DF", padding: "18px 20px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                    <EditField label="Name"><input value={editName} onChange={(e) => setEditName(e.target.value)} style={editInput} /></EditField>
                    <EditField label="Email / username"><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={editInput} /></EditField>
                    <EditField label="Role"><select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={editInput}><option value="student">Student</option><option value="admin">Admin</option></select></EditField>
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
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={createUser} style={{ width: "100%", background: "#4C43D9", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Create user</button>
          </div>
        </div>
      )}

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
      {tab === "images" && <ImagesTab />}
    </div>
  );
}

/* ===== CONFIG TAB ===== */
function ConfigTab() {
  const [elKey, setElKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string; category: string; gender: string }[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  async function saveKey(key: string, value: string) {
    if (!value.trim()) return;
    setSaving(key);
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: value.trim() }),
    });
    setSaving(null);
    setSaved(key);
    setTimeout(() => setSaved(null), 2000);
  }

  async function testVoices() {
    setVoicesLoading(true);
    setVoiceError("");
    const res = await fetch("/api/elevenlabs/voices");
    const j = await res.json();
    if (j.voices?.length) {
      setVoices(j.voices);
    } else {
      setVoiceError(j.error || "No voices returned. Check your API key.");
    }
    setVoicesLoading(false);
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 760 }}>
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, margin: "0 0 6px" }}>Config & API Keys</h2>
      <p style={{ color: "#6B6459", fontSize: 15, margin: "0 0 28px" }}>Keys are stored securely in the database. They are never exposed to students.</p>

      {/* ElevenLabs */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🎙</span>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>ElevenLabs API Key</div>
          <span style={{ fontSize: 12, background: "#ECEBFB", color: "#4C43D9", borderRadius: 20, padding: "3px 10px", fontWeight: 700 }}>Required for voice</span>
        </div>
        <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 14px" }}>Get your key from elevenlabs.io → Profile → API Keys. Students will be able to choose their own voice from available ElevenLabs voices.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={elKey}
            onChange={(e) => setElKey(e.target.value)}
            type="password"
            placeholder="sk_..."
            style={{ flex: 1, border: "1px solid #E0D9CC", borderRadius: 10, padding: "11px 13px", fontSize: 14 }}
          />
          <button
            onClick={() => saveKey("elevenlabs_api_key", elKey)}
            disabled={saving === "elevenlabs_api_key"}
            style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "0 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            {saving === "elevenlabs_api_key" ? "Saving…" : saved === "elevenlabs_api_key" ? "✓ Saved" : "Save"}
          </button>
        </div>
        <button onClick={testVoices} disabled={voicesLoading} style={{ marginTop: 12, background: "#F1ECE2", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#4C43D9" }}>
          {voicesLoading ? "Loading voices…" : "Test connection & list voices"}
        </button>
        {voiceError && <div style={{ marginTop: 8, color: "#C0392B", fontSize: 13, fontWeight: 600 }}>{voiceError}</div>}
        {voices.length > 0 && (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
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

      {/* OpenAI */}
      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🎨</span>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>OpenAI API Key</div>
          <span style={{ fontSize: 12, background: "#E4F3EC", color: "#1E7A50", borderRadius: 20, padding: "3px 10px", fontWeight: 700 }}>Optional — for AI image generation</span>
        </div>
        <p style={{ fontSize: 13, color: "#8A8172", margin: "0 0 14px" }}>Required only if you want DALL-E generated topic images. Web search images work without this key.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            type="password"
            placeholder="sk-..."
            style={{ flex: 1, border: "1px solid #E0D9CC", borderRadius: 10, padding: "11px 13px", fontSize: 14 }}
          />
          <button
            onClick={() => saveKey("openai_api_key", openaiKey)}
            disabled={saving === "openai_api_key"}
            style={{ background: "#2E9E6B", color: "#fff", border: "none", borderRadius: 10, padding: "0 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            {saving === "openai_api_key" ? "Saving…" : saved === "openai_api_key" ? "✓ Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== IMAGES TAB ===== */
type TopicImage = { id: string; image_url: string; thumbnail_url: string; alt_text: string; source: string };

function ImagesTab() {
  const [topicName, setTopicName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [images, setImages] = useState<TopicImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<"web" | "ai" | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualAlt, setManualAlt] = useState("");
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function loadImages() {
    if (!topicName || !subjectName) return;
    setLoading(true);
    setSearched(true);
    const res = await fetch(`/api/images?topicName=${encodeURIComponent(topicName)}&subjectName=${encodeURIComponent(subjectName)}`);
    const j = await res.json();
    setImages(j.images || []);
    setLoading(false);
  }

  async function generate(action: "web" | "ai") {
    if (!topicName || !subjectName) { setError("Enter topic and subject first."); return; }
    setGenerating(action);
    setError("");
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName, subjectName, action }),
    });
    const j = await res.json();
    if (!res.ok) { setError(j.error || "Failed"); setGenerating(null); return; }
    setImages(j.images || []);
    setGenerating(null);
  }

  async function saveManual() {
    if (!manualUrl || !topicName || !subjectName) { setError("Fill all fields."); return; }
    setError("");
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicName, subjectName, action: "manual", imageUrl: manualUrl, altText: manualAlt }),
    });
    const j = await res.json();
    if (!res.ok) { setError(j.error || "Failed"); return; }
    setImages(j.images || []);
    setManualUrl(""); setManualAlt("");
  }

  async function deleteImage(id: string) {
    await fetch(`/api/images?id=${id}`, { method: "DELETE" });
    setImages((imgs) => imgs.filter((i) => i.id !== id));
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, margin: "0 0 6px" }}>Topic Images</h2>
      <p style={{ color: "#6B6459", fontSize: 15, margin: "0 0 24px" }}>Pre-generate images for topics. They are stored once and shown to all students under "Useful Resources" in lessons.</p>

      <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end", marginBottom: 16 }}>
          <div>
            <label style={smallLabel}>Topic name</label>
            <input value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="e.g. The Atom" style={panelInput} />
          </div>
          <div>
            <label style={smallLabel}>Subject name</label>
            <input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="e.g. Grade 7 Chemistry" style={panelInput} />
          </div>
          <button onClick={loadImages} style={{ background: "#23201B", color: "#fff", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 700, cursor: "pointer", fontSize: 14, height: 44 }}>Load</button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <button
            onClick={() => generate("web")}
            disabled={generating !== null}
            style={{ background: "#4C43D9", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
          >
            {generating === "web" ? "Searching…" : "🔍 Find web image"}
          </button>
          <button
            onClick={() => generate("ai")}
            disabled={generating !== null}
            style={{ background: "#2E9E6B", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
          >
            {generating === "ai" ? "Generating…" : "🎨 Generate AI image"}
          </button>
        </div>

        <div style={{ borderTop: "1px solid #F1ECE2", paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5A5347", marginBottom: 10 }}>Or paste a URL manually</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10 }}>
            <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://..." style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
            <input value={manualAlt} onChange={(e) => setManualAlt(e.target.value)} placeholder="Alt text / description" style={{ border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
            <button onClick={saveManual} style={{ background: "#E8823A", color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Save</button>
          </div>
        </div>

        {error && <div style={{ marginTop: 12, color: "#C0392B", fontSize: 13, fontWeight: 600 }}>{error}</div>}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8A8172", fontWeight: 600 }}>Loading images…</div>}

      {searched && !loading && images.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#8A8172" }}>
          <div style={{ fontSize: 32 }}>🖼</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>No images yet for this topic.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Use the buttons above to generate or add images.</div>
        </div>
      )}

      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {images.map((img) => (
            <div key={img.id} style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 16, overflow: "hidden" }}>
              <img
                src={img.thumbnail_url}
                alt={img.alt_text}
                style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
                onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/400x250?text=Image+not+available"; }}
              />
              <div style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{img.alt_text}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, background: img.source === "ai" ? "#E4F3EC" : img.source === "web" ? "#ECEBFB" : "#FBE9DC", color: img.source === "ai" ? "#1E7A50" : img.source === "web" ? "#4C43D9" : "#B5561F", borderRadius: 20, padding: "3px 8px", fontWeight: 700 }}>
                    {img.source === "ai" ? "🎨 AI" : img.source === "web" ? "🔍 Web" : "📎 Manual"}
                  </span>
                  <button onClick={() => deleteImage(img.id)} style={{ background: "#FDECEA", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#C0392B" }}>Delete</button>
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
const smallLabel: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#5A5347", marginBottom: 4 };
const panelInput: React.CSSProperties = { width: "100%", border: "1px solid #E0D9CC", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 0 };
