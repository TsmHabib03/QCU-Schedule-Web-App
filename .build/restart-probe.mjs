// Throwaway: verify a task survives a dev-server restart (data lives in the emulator).
const BASE = process.env.BASE || "http://127.0.0.1:8797";
const SESSION_SECRET = "9598879826a344d8ac267a6754ee6d183aeb8d1f7d9ff6988c7f6167ce30e4d8";

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

const session = {
  userId: "user_restart_probe", googleSub: "restart_probe", email: "probe@qcu.edu.ph",
  name: "Restart Probe", state: "ACTIVE", role: "student", createdAt: new Date().toISOString(),
};

const cookie = `qcu_platform_session=${await seal(session, SESSION_SECRET)}`;
const mode = process.argv[2];

if (mode === "create") {
  const res = await fetch(`${BASE}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "Survives a restart", priority: "HIGH", dueDate: "2026-11-11" }),
  });
  const body = await res.json();
  console.log(`create -> ${res.status} ${body.data?.taskId || JSON.stringify(body)}`);
} else {
  const res = await fetch(`${BASE}/api/v1/tasks`, { headers: { Cookie: cookie } });
  const body = await res.json();
  const rows = body.data?.tasks || body.data || [];
  console.log(`list -> ${res.status}, ${rows.length} task(s)`);
  for (const t of rows) console.log(`   ${t.taskId}  ${t.title}  ${t.priority}  due ${t.dueDate}`);
}

if (mode === "dashboard") {
  const s = { ...session, googleSub: "synthetic_student_a", userId: "user_synthetic_student_a" };
  const c = `qcu_platform_session=${await seal(s, SESSION_SECRET)}`;
  for (const path of ["/api/v1/dashboard", "/api/v1/bootstrap", "/api/v1/schedule", "/api/v1/onboarding/status", "/api/v1/me"]) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: c } });
    const text = await res.text();
    console.log(`${path} -> ${res.status} (${text.length} bytes)`);
    if (res.status >= 400) console.log(`   ${text.slice(0, 200)}`);
  }
}

if (mode === "entries") {
  const s = { ...session, googleSub: "synthetic_student_a", userId: "user_synthetic_student_a" };
  const c = `qcu_platform_session=${await seal(s, SESSION_SECRET)}`;
  const sched = await (await fetch(`${BASE}/api/v1/schedule`, { headers: { Cookie: c } })).json();
  const first = (sched.data?.entries || sched.entries || [])[0];
  console.log(`existing entry sample: ${JSON.stringify(first)?.slice(0, 160)}`);
  const ensId = first?.enrollmentSubjectId;
  const create = await fetch(`${BASE}/api/v1/schedule/entries`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: c },
    body: JSON.stringify({ enrollmentSubjectId: ensId, dayOfWeek: 6, startTime: "16:00", endTime: "17:30", modality: "ONSITE" }),
  });
  const created = await create.json();
  console.log(`create entry -> ${create.status} ${created.data?.entryId || JSON.stringify(created).slice(0, 200)}`);
  const id = created.data?.entryId;
  if (id) {
    const patch = await fetch(`${BASE}/api/v1/schedule/entries/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify({ startTime: "16:30", endTime: "18:00" }),
    });
    console.log(`patch entry  -> ${patch.status} ${(await patch.text()).slice(0, 120)}`);
    const del = await fetch(`${BASE}/api/v1/schedule/entries/${id}`, { method: "DELETE", headers: { Cookie: c } });
    console.log(`delete entry -> ${del.status} ${(await del.text()).slice(0, 120)}`);
  }
}
