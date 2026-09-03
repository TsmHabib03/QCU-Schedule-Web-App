// Smoke test for Tasks + Notes CRUD endpoints
// Override the target with BASE=http://127.0.0.1:8799 to test another port.

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const SESSION_SECRET = "9598879826a344d8ac267a6754ee6d183aeb8d1f7d9ff6988c7f6167ce30e4d8";

// ── Seal/unseal (inline) ────────────────────────────────────────────────

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return encodeBytes(iv) + "." + encodeBytes(new Uint8Array(encrypted));
}

// ── Test users ──────────────────────────────────────────────────────────

const MARIA = { googleSub: "synthetic_student_a" };
const JUAN  = { googleSub: "synthetic_student_b" };

async function makeSession(user) {
  return seal({ googleSub: user.googleSub, ts: Date.now() }, SESSION_SECRET);
}

async function api(method, path, cookie, body) {
  const opts = { method, headers: { Cookie: `qcu_platform_session=${cookie}` } };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}${path}`, opts);
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}

let passed = 0, failed = 0;
function assert(label, cond) {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}`); }
}

console.log("\n=== Tasks CRUD ===\n");

const mariaCookie = await makeSession(MARIA);
const juanCookie  = await makeSession(JUAN);

// 1. Empty list
const list0 = await api("GET", "/api/v1/tasks", mariaCookie);
assert("Maria GET tasks returns 200", list0.status === 200);
assert("Maria tasks is array", Array.isArray(list0.data?.data));

// 2. Create task
const create1 = await api("POST", "/api/v1/tasks", mariaCookie, {
  title: "Submit Problem Set 3",
  description: "Chapters 5-7",
  priority: "HIGH",
});
assert("Create task returns 201", create1.status === 201);
const taskId = create1.data?.data?.taskId;
assert("Task has tsk_ prefix", taskId?.startsWith("tsk_"));
assert("Task title matches", create1.data?.data?.title === "Submit Problem Set 3");
assert("Task priority HIGH", create1.data?.data?.priority === "HIGH");
assert("Task status OPEN", create1.data?.data?.status === "OPEN");

// 3. Create second task
const create2 = await api("POST", "/api/v1/tasks", mariaCookie, {
  title: "Review lecture notes",
  priority: "MEDIUM",
});
assert("Second task created", create2.status === 201);
const taskId2 = create2.data?.data?.taskId;

// 4. List shows both
const list1 = await api("GET", "/api/v1/tasks", mariaCookie);
assert("List shows 2 tasks", list1.data?.data?.length === 2);

// 5. Patch task
const patch1 = await api("PATCH", `/api/v1/tasks/${taskId}`, mariaCookie, {
  status: "COMPLETED",
  description: "Chapters 5-7 (revised)",
});
assert("Patch returns 200", patch1.status === 200);
assert("Status updated to COMPLETED", patch1.data?.data?.status === "COMPLETED");
assert("Description updated", patch1.data?.data?.description === "Chapters 5-7 (revised)");
assert("completedAt set", patch1.data?.data?.completedAt != null);

// 6. Juan can't see Maria's tasks
const juanList = await api("GET", "/api/v1/tasks", juanCookie);
assert("Juan sees 0 tasks (isolation)", juanList.data?.data?.length === 0);

// 7. Juan can't patch Maria's task
const juanPatch = await api("PATCH", `/api/v1/tasks/${taskId}`, juanCookie, {
  title: "HACKED",
});
assert("Juan patch returns 404 (isolation)", juanPatch.status === 404);

// 8. Juan can't delete Maria's task
const juanDel = await api("DELETE", `/api/v1/tasks/${taskId}`, juanCookie);
assert("Juan delete returns 404 (isolation)", juanDel.status === 404);

// 9. Soft delete
const del1 = await api("DELETE", `/api/v1/tasks/${taskId2}`, mariaCookie);
assert("Delete returns 200", del1.status === 200);
assert("Delete returns DELETED status", del1.data?.data?.status === "DELETED");

// 10. Deleted task not in list
const list2 = await api("GET", "/api/v1/tasks", mariaCookie);
assert("List shows 1 task after delete", list2.data?.data?.length === 1);

// 11. Can't update deleted task
const patchDeleted = await api("PATCH", `/api/v1/tasks/${taskId2}`, mariaCookie, {
  title: "Try to revive",
});
assert("Patch deleted returns 404", patchDeleted.status === 404);

console.log("\n=== Notes CRUD ===\n");

// 12. Create note
const noteCreate1 = await api("POST", "/api/v1/notes", mariaCookie, {
  title: "Lecture 5 Notes",
  body: "Important concepts about loops and recursion",
});
assert("Create note returns 201", noteCreate1.status === 201);
const noteId = noteCreate1.data?.data?.noteId;
assert("Note has nt_ prefix", noteId?.startsWith("nt_"));
assert("Note title matches", noteCreate1.data?.data?.title === "Lecture 5 Notes");

// 13. Create second note
const noteCreate2 = await api("POST", "/api/v1/notes", mariaCookie, {
  title: "Study guide for midterm",
  body: "Review chapters 1-8",
});
assert("Second note created", noteCreate2.status === 201);
const noteId2 = noteCreate2.data?.data?.noteId;

// 14. List shows both
const noteList1 = await api("GET", "/api/v1/notes", mariaCookie);
assert("Notes list shows 2", noteList1.data?.data?.length === 2);

// 15. Patch note
const notePatch1 = await api("PATCH", `/api/v1/notes/${noteId}`, mariaCookie, {
  title: "Lecture 5 Notes (updated)",
  body: "Updated content",
});
assert("Note patch returns 200", notePatch1.status === 200);
assert("Note title updated", notePatch1.data?.data?.title === "Lecture 5 Notes (updated)");

// 16. Juan isolation for notes
const juanNoteList = await api("GET", "/api/v1/notes", juanCookie);
assert("Juan sees 0 notes (isolation)", juanNoteList.data?.data?.length === 0);

const juanNotePatch = await api("PATCH", `/api/v1/notes/${noteId}`, juanCookie, {
  title: "HACKED",
});
assert("Juan note patch returns 404 (isolation)", juanNotePatch.status === 404);

// 17. Delete note
const noteDel1 = await api("DELETE", `/api/v1/notes/${noteId2}`, mariaCookie);
assert("Note delete returns 200", noteDel1.status === 200);

const noteList2 = await api("GET", "/api/v1/notes", mariaCookie);
assert("Notes list shows 1 after delete", noteList2.data?.data?.length === 1);

// 18. Validation: missing title
const badTask = await api("POST", "/api/v1/tasks", mariaCookie, { description: "no title" });
assert("Missing title returns 422", badTask.status === 422);

const badNote = await api("POST", "/api/v1/notes", mariaCookie, { body: "no title" });
assert("Missing note title returns 422", badNote.status === 422);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
