# Build Report — Jarvis School Hierarchy v1.0

- **Product:** Jarvis (IB MYP Grade 7 AI tutor) — School Hierarchy layer
- **Version:** 1.0
- **Date:** 2026-07-12
- **Live:** https://ib7.vercel.app
- **Repo:** `IB7thSyllabus` (branch `main`)
- **Commits:**
  - `32218ae` — feature: school hierarchy (portals, grading, wall, messaging)
  - `76bc07f` — security: reject non-http(s) URLs in teacher content (stored XSS)
  - `c2d8111` — security: require `linked_to_school` in grade-teacher flag target check
- **Deployment:** Vercel production (`kkclaudemcp/ib7`), region `bom1`, `readyState: READY`, aliased to `ib7.vercel.app`.

---

## 1. Summary

Added an **opt-in** school-management layer on top of the existing standalone Jarvis tutor. Students not linked to a school see **zero difference**. Admins can link students at any time; linked students gain MYP grading, teacher/guardian visibility, teacher-supplied content, topic flags, and a role-aware messaging wall.

Built in 8 phases, each build-verified. All product code compiles clean (`npm run build`, 31 pages). Verified by live runtime smoke test (not just build). Five security findings surfaced by automated review and two latent bugs were fixed during the build.

---

## 2. Scope delivered

| Phase | Area | Status |
|-------|------|--------|
| 1 | DB migration + MYP criteria seed | ✅ live on prod |
| 2 | Auth, 5 roles, admin school-link UI + API | ✅ |
| 3 | MYP grading engine + progress auto-grade + assessments API | ✅ |
| 4 | Subject Teacher portal (+ teacher APIs) | ✅ |
| 5 | Grade Teacher portal (+ overview/student/flag APIs) | ✅ |
| 6 | Guardian portal (read-only) | ✅ |
| 7 | Wall messaging + student notifications + bell | ✅ |
| 8 | Student-side integration (flags, teacher content, tutor auto-grade) + deploy | ✅ |

---

## 3. Database changes (additive-only, run against prod)

Migration script: `scripts/migrate-school.ts` (idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`; safe to re-run).

**New tables (9):** `schools`, `grade_levels`, `subject_assignments`, `myp_criteria`, `myp_assessments`, `teacher_content`, `topic_flags`, `student_notifications`, `wall_messages`.

**`users` columns added (5):** `school_id`, `grade_level_id`, `linked_to_school BOOLEAN NOT NULL DEFAULT false`, `guardian_id` (student → guardian user), `display_name`.

**Seeded:** `school_iish` (IISH, 2026-2027), `grade_7_iish`, and **28 MYP criteria** (7 subjects × A/B/C/D). Verified present post-migration.

**Notable:** `myp_assessments.overall_1_7` is a `GENERATED ALWAYS AS ... STORED` column deriving the 1–7 band from `raw_score` (0–8) at the DB layer.

---

## 4. Files

### Created
| File | Purpose |
|------|---------|
| `scripts/migrate-school.ts` | Additive migration + criteria seed (CLI, `npx tsx`) |
| `lib/myp.ts` | Grading engine: `sumToIBGrade`, `masteryToCriterionScore`, `getCriteriaForSubject`, `upsertJarvisAssessment`, `getSubjectIBGrade` |
| `lib/school.ts` | `isLinkedToSchool(userId)` guard |
| `app/api/admin/school/route.ts` | Link/unlink students, assign subjects, link guardian; list school users |
| `app/api/assessments/route.ts` | Per-subject + all-subjects grades (GET), teacher confirm/edit (PATCH) |
| `app/api/wall/route.ts` | Role-aware messaging GET/POST/PATCH |
| `app/api/notifications/route.ts` | Student flags + messages + unread count |
| `app/api/teacher/students/route.ts` | Teacher's students + per-subject IB grade |
| `app/api/teacher/content/route.ts` | Teacher content CRUD + student read path |
| `app/api/teacher/flags/route.ts` | Flag a topic for a student |
| `app/api/teacher/criteria/route.ts` | Edit MYP criterion names |
| `app/api/grade-teacher/overview/route.ts` | Students × subjects IB grid |
| `app/api/grade-teacher/student/[id]/route.ts` | Full student profile |
| `app/api/grade-teacher/flag/route.ts` | Grade-teacher topic flag |
| `app/subject-teacher/page.tsx` + `components/SubjectTeacherPortal.tsx` | Subject Teacher portal (4 tabs) |
| `app/grade-teacher/page.tsx` + `components/GradeTeacherPortal.tsx` | Grade Teacher portal (3 tabs) |
| `app/guardian/page.tsx` + `components/GuardianPortal.tsx` | Guardian read-only dashboard |
| `components/Wall.tsx` | Reusable role-aware wall component |

### Modified
`lib/auth.ts` (5-role union + school fields + extended `getCurrentUser` SELECT), `lib/types.ts` (Role union, `linkedToSchool`), `app/page.tsx` (role redirect + pass linked flag), `components/Login.tsx` (client role redirect), `components/AdminPortal.tsx` (school-link column, role creation, guardian/subject selectors), `app/api/admin/users/route.ts` + `[id]/route.ts` (5-role allowlist), `app/api/me/route.ts` (expose `linkedToSchool`), `app/api/progress/route.ts` (auto-grade hook), `app/api/tutor/route.ts` (criterion-A auto-suggest), `components/StudentApp.tsx` (bell, flag badges, kick message, teacher content — all gated behind linked status).

---

## 5. Security findings & fixes

All surfaced by automated security review; all fixed and deployed.

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | HIGH | `api/assessments` GET | IDOR — any user could read any student's grades | Ownership/role scoping: self, guardian→own child, subject_teacher→assigned subjects, grade_teacher/admin→all |
| 2 | HIGH | `api/assessments` PATCH | Any subject_teacher could edit any subject | Load target row, verify teacher assigned to that subject |
| 3 | HIGH | `api/wall` POST | Broadcast-scope bypass — student could grade-broadcast / DM anyone | Scope-gate `toUserId`/`subjectContext`/`gradeContext` by role |
| 4 | HIGH | `api/teacher/flags` POST | Notification injection to arbitrary account | Require target `role='student'` AND `linked_to_school` |
| 5 | HIGH/MED | `StudentApp` + `api/teacher/content` | Stored XSS via `javascript:`/`data:` URIs in image/video content | http(s)-only scheme validation, client **and** server |
| 6 | MED | `api/grade-teacher/flag` POST | Missing `linked_to_school` check (sibling of #4) | Same target validation as #4 |

---

## 6. Bugs fixed en route (not in original spec)

- **Un-awaited `updateProgress`** in `api/progress` (and mirrored in `api/tutor`): the route serialized an unresolved Promise, so persisted mastery wasn't read. Now awaited.
- **Silent role demotion:** admin user-edit coerced any role to `admin`/`student`, silently demoting teachers/guardians on any edit. Now validated against the 5-role allowlist.

---

## 7. Deviations & known limitations

- **"From your teacher" content** renders in the Canvas (primary lesson) tab only, not duplicated across all 5 tool tabs.
- **Guardian flags feed:** guardians see unconfirmed assessments in danger styling rather than a dedicated flags feed (no guardian-facing flags endpoint; avoided fabricating one).
- **Subject list** for teacher assignment uses a fixed 8-group MYP list, not derived from syllabus files.
- **No automated test suite** exists in this repo; verification was build + live smoke test. Grading math, authz gates, and wall scoping are logic worth durable test coverage.
- **Wall PATCH** marks the related notification read (heuristic by sender+content) since `wall_messages` has no read column.

---

## 8. Verification performed

- `npm run build` — clean compile, 31 pages, all routes registered.
- Live runtime smoke test: `/` → 200 (standalone unaffected), `/guardian` `/grade-teacher` `/subject-teacher` → 307 (role gate), `/api/me` → 401 (auth guard).
- Migration verified: all 9 tables + 5 columns + 28 criteria present on prod.

---

## 9. Effort / cost notes

- Executed via 6 delegated subagents (one per major phase) to keep the build tractable; core auth, security fixes, and deploy handled directly.
- Session cost ~$110 — driven by the 8-phase autonomous build plus five security-review round-trips, each requiring a fix + rebuild + redeploy.
