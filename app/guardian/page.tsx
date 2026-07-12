import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import GuardianPortal from "@/components/GuardianPortal";

export const dynamic = "force-dynamic";

type Child = { id: string; name: string; display_name: string | null };

export default async function GuardianPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "guardian") redirect("/");

  let child: Child | null = null;
  try {
    child =
      (await queryOne<Child>(
        "SELECT id, name, display_name FROM users WHERE guardian_id = $1 AND role='student' LIMIT 1",
        [user.id]
      )) ?? null;
  } catch (e) {
    console.error("guardian child lookup failed", e);
  }

  return <GuardianPortal child={child} guardianName={user.name} />;
}
