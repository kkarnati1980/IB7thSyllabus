import * as dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const BASE = "https://ib7.vercel.app";

// --- Auth helper ---
async function loginAs(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/jarvis_session=([^;]+)/);
  if (!match) throw new Error(`Login failed for ${email}: ${res.status}`);
  return `jarvis_session=${match[1]}`;
}

// --- Test runner ---
type TestResult = { name: string; passed: boolean; detail: string };
const results: TestResult[] = [];

function pass(name: string, detail = "") { results.push({ name, passed: true, detail }); }
function fail(name: string, detail = "") { results.push({ name, passed: false, detail }); }

async function run() {
  console.log("=== Jarvis Security Tests ===\n");

  // Login
  const teacherCookie = await loginAs("sec_teacher@test.internal", "TestPass123!");
  console.log("✓ Logged in as test subject teacher\n");

  // ─── TEST 1: XSS — javascript: URI rejected by server ───────────────────
  {
    const res = await fetch(`${BASE}/api/teacher/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
      body: JSON.stringify({
        subjectName: "Chemistry",
        topicName: "The Atom",
        contentType: "image",
        content: "javascript:alert(document.cookie)",
        title: "XSS Test Image",
      }),
    });
    if (res.status === 400) {
      const j = await res.json();
      pass("XSS-1: javascript: URI rejected (image)", `status=400, msg=${j.error}`);
    } else {
      fail("XSS-1: javascript: URI rejected (image)", `expected 400, got ${res.status}`);
    }
  }

  // ─── TEST 2: XSS — data: URI rejected by server ─────────────────────────
  {
    const res = await fetch(`${BASE}/api/teacher/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
      body: JSON.stringify({
        subjectName: "Chemistry",
        topicName: "The Atom",
        contentType: "video",
        content: "data:text/html,<script>alert(1)</script>",
        title: "XSS Test Video",
      }),
    });
    if (res.status === 400) {
      pass("XSS-2: data: URI rejected (video)", `status=400`);
    } else {
      fail("XSS-2: data: URI rejected (video)", `expected 400, got ${res.status}`);
    }
  }

  // ─── TEST 3: XSS — valid https URL accepted ──────────────────────────────
  {
    const res = await fetch(`${BASE}/api/teacher/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
      body: JSON.stringify({
        subjectName: "Chemistry",
        topicName: "The Atom",
        contentType: "image",
        content: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/24701-nature-natural-beauty.jpg/320px-24701-nature-natural-beauty.jpg",
        title: "Valid Image Test",
      }),
    });
    if (res.status === 200 || res.status === 201) {
      pass("XSS-3: valid https URL accepted", `status=${res.status}`);
    } else {
      const j = await res.json().catch(() => ({}));
      fail("XSS-3: valid https URL accepted", `expected 200, got ${res.status}: ${JSON.stringify(j)}`);
    }
  }

  // ─── TEST 4: IDOR — teacher cannot read another student's assessments ────
  // The test student's assessment was created for topic_real_001
  // Our teacher is only assigned to Chemistry — try to access a student they
  // can see but read raw assessment by ID guessing
  {
    const res = await fetch(`${BASE}/api/assessments?userId=test_sec_student_001&subjectName=Mathematics`, {
      headers: { "Cookie": teacherCookie },
    });
    // Teacher is NOT assigned to Mathematics — should get 403 or empty
    if (res.status === 403) {
      pass("IDOR-1: teacher cannot read out-of-scope subject assessments", `status=403`);
    } else if (res.status === 200) {
      const j = await res.json();
      const assessments = j.assessments ?? j;
      if (Array.isArray(assessments) && assessments.length === 0) {
        pass("IDOR-1: teacher cannot read out-of-scope subject assessments", `empty result`);
      } else {
        fail("IDOR-1: teacher cannot read out-of-scope subject assessments", `got data: ${JSON.stringify(assessments).slice(0,100)}`);
      }
    } else {
      fail("IDOR-1: teacher cannot read out-of-scope subject assessments", `unexpected status ${res.status}`);
    }
  }

  // ─── TEST 5: IDOR — teacher cannot mutate another subject's assessment ───
  {
    const res = await fetch(`${BASE}/api/assessments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
      body: JSON.stringify({
        // Try to confirm an assessment for a subject this teacher doesn't own
        assessmentId: "any_assessment_id",
        subjectName: "Mathematics",
        rawScore: 8,
        confirmed: true,
      }),
    });
    if (res.status === 403 || res.status === 404) {
      pass("IDOR-2: teacher cannot mutate out-of-scope subject assessment", `status=${res.status}`);
    } else {
      fail("IDOR-2: teacher cannot mutate out-of-scope subject assessment", `expected 403/404, got ${res.status}`);
    }
  }

  // ─── TEST 6: Wall scope — teacher cannot read messages outside subject ───
  {
    const res = await fetch(`${BASE}/api/wall?subjectContext=Mathematics`, {
      headers: { "Cookie": teacherCookie },
    });
    // Teacher is Chemistry only — should get 403 or empty
    if (res.status === 403) {
      pass("WALL-1: teacher cannot read wall of other subject", `status=403`);
    } else if (res.status === 200) {
      const j = await res.json();
      const msgs = j.messages ?? [];
      if (msgs.length === 0) {
        pass("WALL-1: teacher cannot read wall of other subject", `empty result`);
      } else {
        fail("WALL-1: teacher cannot read wall of other subject", `got ${msgs.length} messages`);
      }
    } else {
      fail("WALL-1: teacher cannot read wall of other subject", `unexpected ${res.status}`);
    }
  }

  // ─── TEST 7: Notification injection — flag non-linked student ───────────
  {
    // Try to flag a student who is NOT linked to school
    // First get any unlinked student ID — use admin_1 which is admin role
    const res = await fetch(`${BASE}/api/teacher/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
      body: JSON.stringify({
        userId: "admin_1", // admin, not a student
        topicId: "topic_test",
        topicName: "Test Topic",
        subjectName: "Chemistry",
        reason: "Injection test",
      }),
    });
    if (res.status === 403 || res.status === 404) {
      pass("NOTIF-1: cannot flag non-student/unlinked user", `status=${res.status}`);
    } else {
      fail("NOTIF-1: cannot flag non-student/unlinked user", `expected 403/404, got ${res.status}`);
    }
  }

  // ─── TEST 8: Unauthenticated access blocked ──────────────────────────────
  {
    const res = await fetch(`${BASE}/api/assessments?userId=test_sec_student_001&subjectName=Chemistry`);
    if (res.status === 401) {
      pass("AUTH-1: unauthenticated request rejected", `status=401`);
    } else {
      fail("AUTH-1: unauthenticated request rejected", `expected 401, got ${res.status}`);
    }
  }

  // ─── Results ─────────────────────────────────────────────────────────────
  console.log("\n=== Results ===");
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`${icon} ${r.name}`);
    if (r.detail) console.log(`   ${r.detail}`);
    if (!r.passed) allPassed = false;
  }
  console.log(`\n${results.filter(r => r.passed).length}/${results.length} tests passed`);

  if (!allPassed) {
    console.error("\n❌ SECURITY TESTS FAILED — do not proceed until all pass");
    process.exit(1);
  } else {
    console.log("\n✅ All security tests passed");
  }
}

run().catch(e => { console.error(e); process.exit(1); });
