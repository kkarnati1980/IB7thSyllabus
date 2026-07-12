# PRD — Jarvis School Hierarchy

- **Product:** Jarvis (IB MYP Grade 7 AI tutor)
- **Feature:** School Hierarchy (roles, MYP grading, portals, messaging)
- **Version:** 1.0
- **Status:** Shipped — live at https://ib7.vercel.app (2026-07-12)
- **Owner:** Kishore

---

## 1. Problem & goal

Jarvis is a standalone AI tutor: an individual student learns 8 MYP subjects on their own. Schools want oversight — teachers who can see progress, grade against MYP criteria, add materials, and flag topics; guardians who can watch their child; and a messaging channel between them.

**Goal:** layer a full school hierarchy onto Jarvis **without disrupting standalone users**. The layer is **opt-in per student** — a student is unaffected until an admin explicitly links them.

**Non-goal for v1.0:** multi-school / multi-grade scale, real-time chat, file uploads, parent self-registration, IB-official report generation.

---

## 2. Principles

1. **Opt-in, zero-diff.** A student with `linked_to_school = false` sees the exact standalone experience — no new UI, no extra network calls that surface anything.
2. **Additive only.** No destructive schema changes; the existing tutor data model is untouched.
3. **Least privilege.** Every role sees and mutates only what it owns. Enforced server-side, not just in the UI.
4. **Jarvis assists, teachers decide.** Jarvis proposes MYP scores; a teacher confirms or overrides. Confirmed scores are never clobbered by automation.

---

## 3. Roles

| Role | Capability |
|------|-----------|
| `admin` | Create users of any role; link/unlink students; assign subjects to teachers; link guardians to students. |
| `grade_teacher` | See all linked students × all subjects (IB grid); drill into any student; send notes; flag topics; view whole-grade wall. |
| `subject_teacher` | See their students for their assigned subjects; confirm/edit MYP scores; add topic content; flag topics; subject wall. |
| `guardian` | Read-only view of their one linked child: grades, topic detail, wall (read-only). |
| `student` | Standalone tutor. If linked: sees flags, teacher content, notification bell, and participates in the wall. |

Roles stored in `users.role`. No DB `CHECK` constraint; the 5-role allowlist is enforced in the user create/edit APIs.

---

## 4. Functional requirements

### 4.1 Admin — user & school management
- FR-1 Create users with role grade_teacher / subject_teacher / guardian / student / admin.
- FR-2 Users tab shows a **School Link** status per student with a link/unlink toggle. Linking sets `linked_to_school=true`, `school_id='school_iish'`, `grade_level_id='grade_7_iish'`; unlinking reverses it.
- FR-3 Creating a guardian requires selecting the student they belong to (sets `students.guardian_id`).
- FR-4 Creating a subject_teacher requires selecting the subjects they teach (writes `subject_assignments`).

### 4.2 MYP grading
- FR-5 Criteria: each subject has criteria A–D (name + max score 8), seeded as IB defaults, editable by teachers per subject.
- FR-6 **Mastery → criterion score:** `masteryToCriterionScore(pct)` maps 0–100% to a 0–8 band (boundaries 12/25/37/50/62/74/87/100).
- FR-7 **Criteria sum → IB grade:** `sumToIBGrade(sum)` maps the summed A–D score (0–32) to a 1–7 band (0→1, ≤5→2, ≤9→3, ≤13→4, ≤17→5, ≤21→6, else 7).
- FR-8 **Auto-suggestion:** when a linked student saves progress, Jarvis upserts A–D criterion scores for that subject/topic (`suggested_by='jarvis'`, `confirmed=false`). The tutor loop additionally keeps criterion A live on positive mastery gain.
- FR-9 **Teacher override:** a teacher may confirm/edit any score for their subject (`confirmed=true`, `suggested_by='teacher'`). Auto-suggestion must never overwrite a confirmed or teacher-edited score.

### 4.3 Subject Teacher portal (4 tabs)
- FR-10 **My Students:** per student, overall IB grade per taught subject; drill to topic-level mastery + A/B/C/D with confirm/edit; "Flag for revision" (reason → `topic_flags` + student notification).
- FR-11 **Topic Content:** add title/type(text|image|video)/body-or-URL; list, toggle visibility, delete.
- FR-12 **MYP Criteria:** edit criterion names for their subject.
- FR-13 **Wall:** messages in their subject context.

### 4.4 Grade Teacher portal (3 tabs)
- FR-14 **Grade Overview:** students (rows) × subjects (cols) grid; each cell the IB 1–7 grade, color-coded (1–2 red, 3–4 orange, 5–6 green, 7 dark green). Cell click drills into the student's subject detail.
- FR-15 From a student detail: send a note, flag a topic.
- FR-16 **Subject Teachers:** list teachers, their subjects, student/assessment counts, content contribution counts.
- FR-17 **Wall:** whole-grade + all subjects.

### 4.5 Guardian portal (read-only)
- FR-18 Overview card: child, overall grade across subjects.
- FR-19 Subjects: per-subject IB grade + criteria; expand to topic detail.
- FR-20 Wall: read-only view of the child's messages. No compose anywhere.
- FR-21 Progress timeline of recent activity.
- FR-22 If no child is linked, a calm empty state.

### 4.6 Wall messaging & notifications
- FR-23 Role-aware GET: each role sees only messages in scope (student: direct + their subject/grade broadcasts; subject_teacher: their subjects; grade_teacher: whole grade; guardian: child's view; admin: all).
- FR-24 POST scoped by role (see 5.2). A DM to a student also creates a `student_notifications` row.
- FR-25 Student notification bell (linked students only): unread count; slide-in panel with flags (red) and messages (blue); flags link to the topic.

### 4.7 Student-side integration (linked students only)
- FR-26 Flagged topics show a red `⚑ Flagged` badge on the home screen.
- FR-27 Opening a flagged topic prepends to Jarvis's kick message: *"Your teacher has flagged this topic for revision: &lt;reason&gt;. Let's focus on that today."*
- FR-28 "From your teacher" section renders visible teacher content for the open topic above Useful Resources.

---

## 5. Non-functional requirements

### 5.1 Opt-in isolation
- NFR-1 With `linked_to_school=false`: no bell, no badges, no flag/content/notification fetches, no behavioral change. Gated on the server-provided linked flag.

### 5.2 Security / authorization (enforced server-side)
- NFR-2 **Assessments read:** self, guardian→own child only, subject_teacher→assigned subjects only, grade_teacher/admin→all. (No IDOR.)
- NFR-3 **Assessments write:** teacher may only edit scores for a subject they're assigned to.
- NFR-4 **Wall scope:** students cannot grade-broadcast or DM peers; subject_teachers limited to assigned subjects and DMs to students; grade broadcast is grade_teacher-only.
- NFR-5 **Flag/notification targets** must be a real `role='student'` AND `linked_to_school=true` account.
- NFR-6 **Teacher content URLs** (image/video) must be http(s) — reject `javascript:`/`data:` schemes, client and server (no stored XSS).
- NFR-7 Every API route requires an authenticated session (401) and role check (403) before work.

### 5.3 Platform
- NFR-8 Stack unchanged: Next.js 15 App Router, TypeScript, raw `pg` via `@/lib/db`, pure inline styles, Supabase Postgres, Vercel (bom1).
- NFR-9 Migrations additive and idempotent; safe to re-run against prod.

---

## 6. Data model (new)

```
schools(id, name, code UNIQUE, academic_year, created_at)
grade_levels(id, school_id→schools, grade, created_at, UNIQUE(school_id,grade))
users += school_id, grade_level_id, linked_to_school, guardian_id→users, display_name
subject_assignments(id, teacher_id→users, subject_name, grade_level_id→grade_levels, UNIQUE(teacher_id,subject_name,grade_level_id))
myp_criteria(id, subject_name, criterion, criterion_name, max_score, configured_by, grade_level_id, UNIQUE(subject_name,criterion,grade_level_id))
myp_assessments(id, user_id→users, subject_name, topic_id, topic_name, criterion, raw_score 0..8,
                suggested_by, confirmed, confirmed_by, overall_1_7 GENERATED STORED, updated_at,
                UNIQUE(user_id,topic_id,criterion))
teacher_content(id, subject_name, topic_name, content_type, content, title, added_by, visible, created_at)
topic_flags(id, user_id, topic_id, topic_name, subject_name, flagged_by, reason, resolved, created_at)
student_notifications(id, user_id, type, content, from_user_id, read, created_at)
wall_messages(id, from_user_id, to_user_id, subject_context, grade_context, content, created_at)
```

---

## 7. API surface (new)

- `GET/POST /api/admin/school` — school-user list; link/unlink, assignSubjects, linkGuardian.
- `GET/PATCH /api/assessments` — grades read; teacher confirm/edit.
- `GET/POST/PATCH /api/wall` — role-aware messaging.
- `GET/PATCH /api/notifications` — student flags/messages; mark read.
- `GET/POST/PATCH/DELETE /api/teacher/content` · `GET/POST /api/teacher/flags` · `GET /api/teacher/students` · `GET/PATCH /api/teacher/criteria`.
- `GET /api/grade-teacher/overview` · `GET /api/grade-teacher/student/[id]` · `POST /api/grade-teacher/flag`.
- Modified: `GET /api/me` now returns `linkedToSchool`.

---

## 8. Acceptance criteria (v1.0 — all met)

- [x] Build passes with zero TypeScript errors; deployed and live.
- [x] Admin can create grade_teacher, subject_teacher, guardian accounts.
- [x] Admin can link/unlink students to the school.
- [x] Grade teacher sees the students × subjects IB grade grid.
- [x] Subject teacher sees their students, confirms MYP scores, adds content, flags topics.
- [x] Guardian sees their child's full progress, read-only.
- [x] Flagged students see badges + Jarvis acknowledges the flag on topic open.
- [x] Wall messages are visible only to the correct roles.
- [x] Unlinked (standalone) students see zero difference.
- [x] Authorization enforced server-side (IDOR, broadcast-scope, injection, XSS all closed).

---

## 9. Out of scope / future (v1.1+)

- Automated test suite for grading math, authz, and wall scope.
- Multi-school / multi-grade support (currently hard-wired to IISH grade 7).
- Teacher content: real file uploads (currently URL-based) and a virus/scan pipeline.
- Guardian-facing flags feed and richer timeline.
- Real-time wall (currently 30s polling) and read receipts for `wall_messages`.
- Teacher content surfaced across all lesson tool tabs (currently Canvas tab only).
