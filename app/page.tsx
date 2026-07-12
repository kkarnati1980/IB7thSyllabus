import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeed, getSubjects, queryOne } from "@/lib/db";
import { getProgress } from "@/lib/progress";
import Login from "@/components/Login";
import StudentApp from "@/components/StudentApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user) return <Login admin={false} />;
  if (user.role === "admin") redirect("/admin");
  if (user.role === "grade_teacher") redirect("/grade-teacher");
  if (user.role === "subject_teacher") redirect("/subject-teacher");
  if (user.role === "guardian") redirect("/guardian");

  const subjects = await getSubjects();
  const progress = await getProgress(user.id);
  const row = await queryOne<{ n: string }>("SELECT COUNT(*) AS n FROM syllabus_chunks");
  const chunkCount = Number(row?.n ?? 0);

  return (
    <StudentApp
      user={{ id: user.id, name: user.name, email: user.email, role: user.role, linkedToSchool: !!user.linked_to_school }}
      initialSubjects={subjects}
      initialProgress={progress}
      initialChunkCount={chunkCount}
    />
  );
}
