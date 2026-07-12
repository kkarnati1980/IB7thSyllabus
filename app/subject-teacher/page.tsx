import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeed, getSubjects } from "@/lib/db";
import SubjectTeacherPortal from "@/components/SubjectTeacherPortal";

export const dynamic = "force-dynamic";

export default async function SubjectTeacherPage() {
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user || user.role !== "subject_teacher") redirect("/");

  const subjects = await getSubjects();
  const syllabus = subjects.map((s) => ({ name: s.name, topics: s.topics }));

  return (
    <SubjectTeacherPortal
      user={{ id: user.id, name: user.display_name || user.name, email: user.email }}
      syllabus={syllabus}
    />
  );
}
