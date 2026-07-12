import { getCurrentUser } from "@/lib/auth";
import { ensureSeed, query } from "@/lib/db";
import Login from "@/components/Login";
import AdminPortal from "@/components/AdminPortal";
import type { PublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

async function listUsers(): Promise<PublicUser[]> {
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    role: "student" | "admin";
    active: boolean;
    created_at: string;
  }>("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC");
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
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return <Login admin={true} />;

  const log = await query<{ action: string; detail: string; at: string }>(
    "SELECT action, detail, at FROM audit_log ORDER BY at DESC LIMIT 50"
  );

  return (
    <AdminPortal
      admin={{ id: user.id, name: user.name, email: user.email }}
      initialUsers={await listUsers()}
      initialLog={log}
    />
  );
}
