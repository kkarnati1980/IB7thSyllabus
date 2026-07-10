import { getCurrentUser } from "@/lib/auth";
import { db, ensureSeed } from "@/lib/db";
import Login from "@/components/Login";
import AdminPortal from "@/components/AdminPortal";
import type { PublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

function listUsers(): PublicUser[] {
  const rows = db
    .prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC")
    .all() as {
    id: string;
    name: string;
    email: string;
    role: "student" | "admin";
    active: number;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    active: !!r.active,
    createdAt: r.created_at,
  }));
}

export default async function AdminPage() {
  ensureSeed();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return <Login admin={true} />;

  const log = db
    .prepare("SELECT action, detail, at FROM audit_log ORDER BY at DESC LIMIT 50")
    .all() as { action: string; detail: string; at: string }[];

  return (
    <AdminPortal
      admin={{ id: user.id, name: user.name, email: user.email }}
      initialUsers={listUsers()}
      initialLog={log}
    />
  );
}
