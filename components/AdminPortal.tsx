"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/types";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

type AuditRow = { action: string; detail: string; at: string };

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
  const [tab, setTab] = useState<"users" | "audit">("users");
  const [users, setUsers] = useState<PublicUser[]>(initialUsers);
  const [log, setLog] = useState<AuditRow[]>(initialLog);

  // create panel
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("student");
  const [newError, setNewError] = useState("");

  // inline edit
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
    if (!newName || !newEmail || !newPass) {
      setNewError("All fields required.");
      return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, email: newEmail, password: newPass, role: newRole }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNewError(j.error || "Could not create user.");
      return;
    }
    setUsers(j.users);
    setNewName("");
    setNewEmail("");
    setNewPass("");
    setNewError("");
    refreshAudit();
  }

  async function toggleUser(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    if (res.ok) {
      setUsers((await res.json()).users);
      refreshAudit();
    }
  }

  function startEdit(u: PublicUser) {
    setEditId(u.id);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditPass("");
    setEditError("");
  }

  async function saveEdit() {
    if (!editId) return;
    if (!editName.trim() || !editEmail.trim()) {
      setEditError("Name and email required.");
      return;
    }
    const res = await fetch(`/api/admin/users/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        email: editEmail,
        role: editRole,
        password: editPass,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEditError(j.error || "Could not save.");
      return;
    }
    setUsers(j.users);
    setEditId(null);
    setEditError("");
    refreshAudit();
  }

  async function deleteUser(id: string) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((await res.json()).users);
      if (editId === id) setEditId(null);
      refreshAudit();
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "9px 4px",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    borderBottom: `3px solid ${active ? "#4C43D9" : "transparent"}`,
    background: "transparent",
    color: active ? "#4C43D9" : "#8A8172",
    maxWidth: 160,
  });

  const studentCount = users.filter((u) => u.role === "student").length;
  const activeCount = users.filter((u) => u.active).length;

  return (
    <div style={{ minHeight: "100vh", background: "#EFEAE0", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div
        style={{
          background: "#23201B",
          color: "#fff",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "linear-gradient(150deg,#6B62F5,#4C43D9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          J
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>Jarvis Admin Portal</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Logged in as {admin.email}</div>
        </div>
        <button
          onClick={logout}
          style={{
            background: "#C0392B",
            border: "none",
            color: "#fff",
            borderRadius: 10,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      {/* stats */}
      <div style={{ display: "flex", gap: 14, padding: "24px 32px 0", flexWrap: "wrap" }}>
        <StatCard value={studentCount} label="Student accounts" color="#4C43D9" />
        <StatCard value={activeCount} label="Active users" color="#2E9E6B" />
        <div
          style={{
            background: "#4C43D9",
            borderRadius: 16,
            padding: "18px 24px",
            minWidth: 160,
            color: "#fff",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>SOC2 Controls</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            scrypt hashing · Audit log · Session mgmt · Role-based access
          </div>
        </div>
      </div>

      {/* tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "20px 32px 0",
          borderBottom: "1px solid #E7E1D6",
          background: "#EFEAE0",
          marginTop: 16,
        }}
      >
        <button onClick={() => setTab("users")} style={tabStyle(tab === "users")}>
          👥 Users
        </button>
        <button
          onClick={() => {
            setTab("audit");
            refreshAudit();
          }}
          style={tabStyle(tab === "audit")}
        >
          📋 Audit Log
        </button>
      </div>

      {tab === "users" ? (
        <div
          style={{
            padding: "24px 32px",
            display: "grid",
            gridTemplateColumns: "1fr 360px",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* user table */}
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #E7E1D6",
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              All users
            </div>
            {users.map((u) => (
              <div key={u.id} style={{ borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px" }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      background: "#ECEBFB",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontFamily: DISPLAY,
                      color: "#4C43D9",
                      fontSize: 16,
                      flex: "0 0 38px",
                    }}
                  >
                    {(u.name || "?")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {u.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#8A8172" }}>
                      {u.email} · {u.role}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: u.active ? "#2E9E6B" : "#C0392B",
                      minWidth: 48,
                    }}
                  >
                    {u.active ? "Active" : "Disabled"}
                  </div>
                  <div style={{ fontSize: 12, color: "#A79E8E", minWidth: 80 }}>
                    {u.createdAt.slice(0, 10)}
                  </div>
                  <button
                    onClick={() => toggleUser(u.id)}
                    style={{
                      background: "#F6F3EC",
                      border: "1px solid #E7E1D6",
                      borderRadius: 9,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: u.active ? "#E8823A" : "#2E9E6B",
                    }}
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => startEdit(u)}
                    style={{
                      background: "#ECEBFB",
                      border: "none",
                      borderRadius: 9,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: "#4C43D9",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteUser(u.id)}
                    style={{
                      background: "#FDECEA",
                      border: "none",
                      borderRadius: 9,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: "#C0392B",
                    }}
                  >
                    Delete
                  </button>
                </div>

                {editId === u.id && (
                  <div
                    style={{
                      background: "#F6F3EC",
                      borderTop: "1px solid #EEE9DF",
                      padding: "18px 20px 20px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 12,
                      alignItems: "end",
                    }}
                  >
                    <EditField label="Name">
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={editInput} />
                    </EditField>
                    <EditField label="Email / username">
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={editInput} />
                    </EditField>
                    <EditField label="Role">
                      <select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={editInput}>
                        <option value="student">Student</option>
                        <option value="admin">Admin</option>
                      </select>
                    </EditField>
                    <EditField label="New password (leave blank to keep)">
                      <input
                        value={editPass}
                        onChange={(e) => setEditPass(e.target.value)}
                        type="password"
                        placeholder="••••••••"
                        style={editInput}
                      />
                    </EditField>
                    <div style={{ gridColumn: "2 / 4" }}>
                      {editError && (
                        <div
                          style={{
                            background: "#FDECEA",
                            color: "#C0392B",
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "7px 10px",
                            borderRadius: 8,
                            marginBottom: 8,
                          }}
                        >
                          {editError}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => setEditId(null)}
                          style={{
                            background: "#fff",
                            border: "1px solid #E0D9CC",
                            borderRadius: 9,
                            padding: "9px 18px",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            color: "#5A5347",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEdit}
                          style={{
                            background: "#4C43D9",
                            border: "none",
                            borderRadius: 9,
                            padding: "9px 18px",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            color: "#fff",
                          }}
                        >
                          Save changes
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* create panel */}
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, padding: 22 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
              Create account
            </div>
            {newError && (
              <div
                style={{
                  background: "#FDECEA",
                  color: "#C0392B",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "9px 12px",
                  borderRadius: 10,
                  marginBottom: 12,
                }}
              >
                {newError}
              </div>
            )}
            <label style={smallLabel}>Full name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Student Name" style={panelInput} />
            <label style={smallLabel}>Email / username</label>
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="student@school.edu"
              style={panelInput}
            />
            <label style={smallLabel}>Password</label>
            <input
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              type="password"
              placeholder="••••••••"
              style={panelInput}
            />
            <label style={smallLabel}>Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              style={{ ...panelInput, background: "#fff" }}
            >
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={createUser}
              style={{
                width: "100%",
                background: "#4C43D9",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: 12,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Create user
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: "#fff", border: "1px solid #E7E1D6", borderRadius: 18, overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #E7E1D6",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16 }}>Security audit log</div>
              <div style={{ fontSize: 12, color: "#8A8172" }}>Last 50 events · All times UTC</div>
            </div>
            {log.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: "12px 20px",
                  borderBottom: "1px solid #F5F0E8",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color:
                      l.action.includes("FAIL") || l.action.includes("DELETE")
                        ? "#C0392B"
                        : l.action.includes("LOGIN")
                          ? "#2E9E6B"
                          : "#4C43D9",
                    minWidth: 110,
                    paddingTop: 1,
                  }}
                >
                  {l.action}
                </span>
                <span style={{ fontSize: 13, flex: 1, color: "#4A453C" }}>{l.detail}</span>
                <span style={{ fontSize: 11, color: "#A79E8E", minWidth: 140, textAlign: "right" }}>
                  {l.at.replace("T", " ").slice(0, 19)}
                </span>
              </div>
            ))}
          </div>
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
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: "#5A5347",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const editInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid #E0D9CC",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 14,
  background: "#fff",
};

const smallLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#5A5347",
  marginBottom: 4,
};

const panelInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid #E0D9CC",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  marginBottom: 12,
};
