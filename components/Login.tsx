"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";

export default function Login({ admin }: { admin: boolean }) {
  const router = useRouter();
  const [reg, setReg] = useState(false);
  const [busy, setBusy] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regError, setRegError] = useState("");

  async function doLogin() {
    if (!loginEmail || !loginPass) {
      setLoginError("Please enter credentials.");
      return;
    }
    setBusy(true);
    setLoginError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password: loginPass, admin }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setLoginError(j.error || "Invalid username or password.");
      return;
    }
    router.refresh();
  }

  async function doRegister() {
    if (!regName || !regEmail || !regPass) {
      setRegError("All fields required.");
      return;
    }
    if (regPass.length < 8) {
      setRegError("Password must be 8+ characters.");
      return;
    }
    setBusy(true);
    setRegError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: regName, email: regEmail, password: regPass }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setRegError(j.error || "Could not create account.");
      return;
    }
    router.refresh();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #E0D9CC",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 15,
    marginBottom: 14,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#EFEAE0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: "linear-gradient(150deg,#6B62F5,#4C43D9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontWeight: 800,
              color: "#fff",
              fontSize: 28,
              margin: "0 auto 12px",
              boxShadow: "0 10px 30px rgba(76,67,217,.4)",
            }}
          >
            J
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, letterSpacing: "-.02em" }}>
            Jarvis
          </div>
          <div style={{ fontSize: 14, color: "#8A8172", marginTop: 4 }}>
            {admin ? "Admin Portal" : "IB MYP Self-Learning Studio"}
          </div>
        </div>

        {reg && !admin ? (
          <div
            style={{
              background: "#fff",
              borderRadius: 24,
              border: "1px solid #E7E1D6",
              padding: 32,
              boxShadow: "0 20px 60px -20px rgba(0,0,0,.12)",
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, marginBottom: 20 }}>
              Create account
            </div>
            {regError && (
              <div
                style={{
                  background: "#FDECEA",
                  color: "#C0392B",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "10px 14px",
                  borderRadius: 10,
                  marginBottom: 14,
                }}
              >
                {regError}
              </div>
            )}
            <label style={labelStyle}>Full name</label>
            <input
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="Aarav Sharma"
              style={inputStyle}
            />
            <label style={labelStyle}>Email</label>
            <input
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
              placeholder="aarav@school.edu"
              type="email"
              style={inputStyle}
            />
            <label style={labelStyle}>
              Password <span style={{ fontWeight: 400, color: "#A79E8E" }}>(min 8 chars)</span>
            </label>
            <input
              value={regPass}
              onChange={(e) => setRegPass(e.target.value)}
              type="password"
              placeholder="••••••••"
              style={{ ...inputStyle, marginBottom: 20 }}
            />
            <button onClick={doRegister} disabled={busy} style={primaryBtn}>
              {busy ? "Creating…" : "Create account"}
            </button>
            <button
              onClick={() => {
                setReg(false);
                setRegError("");
              }}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                color: "#8A8172",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ← Back to login
            </button>
          </div>
        ) : (
          <div
            style={{
              background: "#fff",
              borderRadius: 24,
              border: "1px solid #E7E1D6",
              padding: 32,
              boxShadow: "0 20px 60px -20px rgba(0,0,0,.12)",
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, marginBottom: 20 }}>
              Sign in
            </div>
            {loginError && (
              <div
                style={{
                  background: "#FDECEA",
                  color: "#C0392B",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "10px 14px",
                  borderRadius: 10,
                  marginBottom: 14,
                }}
              >
                {loginError}
              </div>
            )}
            <label style={labelStyle}>{admin ? "Username" : "Email"}</label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              placeholder={admin ? "admin" : "you@school.edu"}
              style={inputStyle}
            />
            <label style={labelStyle}>Password</label>
            <input
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              type="password"
              placeholder="••••••••"
              style={{ ...inputStyle, marginBottom: 20 }}
            />
            <button onClick={doLogin} disabled={busy} style={{ ...primaryBtn, marginBottom: 14 }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {admin ? (
              <div style={{ textAlign: "center", fontSize: 12, color: "#A79E8E" }}>
                Admin portal · SOC2-aligned session management
              </div>
            ) : (
              <button
                onClick={() => {
                  setReg(true);
                  setLoginError("");
                }}
                style={{
                  width: "100%",
                  background: "none",
                  border: "1px solid #E7E1D6",
                  borderRadius: 14,
                  padding: 12,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  color: "#4C43D9",
                }}
              >
                New student? Create account
              </button>
            )}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#A79E8E" }}>
          scrypt password hashing · Session tokens · Audit logging
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 5,
  color: "#5A5347",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  background: "#4C43D9",
  color: "#fff",
  border: "none",
  borderRadius: 14,
  padding: 14,
  fontWeight: 700,
  fontSize: 16,
  cursor: "pointer",
  marginBottom: 12,
};
