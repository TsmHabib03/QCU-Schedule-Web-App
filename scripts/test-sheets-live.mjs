// End-to-end check against the deployed Apps Script web app.
//
//   npm run sheets:test
//
// Verifies the whole persistence path: the signature is accepted, snapshot.read
// returns rows, batch.write commits them, and the field mapping survives a real
// round trip through the spreadsheet. Also reports latency, because two round
// trips per request is the budget the hydrate/flush design was built around.
//
// Writes and then deletes its own rows under a dedicated test identity, so it
// never touches a real student's data.

import { callAction, readSnapshot, writeBatch } from "../functions/api/repo/sheets-adapter.js";
import { loadEnv, reportError } from "./_sheets-client.mjs";

const ACTOR = { googleSub: "test-harness-000", email: "test-harness@localhost" };
const USER_ID = `user_${ACTOR.googleSub}`;

let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function timed(label, fn) {
  const started = Date.now();
  const value = await fn();
  const ms = Date.now() - started;
  console.log(`  ${ms.toString().padStart(5)}ms ${label}`);
  return { value, ms };
}

async function main() {
  const env = await loadEnv();
  const ts = new Date().toISOString();
  const taskId = `tsk_test_${Date.now()}`;
  const noteId = `nte_test_${Date.now()}`;

  console.log("\n=== Apps Script health ===");
  const healthUrl = `${env.APPS_SCRIPT_URL}?action=health`;
  const health = await (await fetch(healthUrl, { redirect: "follow" })).json();
  check("web app reachable and returns JSON", health.ok === true);
  check(
    `all sheets present (${health.data?.sheetsPresent}/${health.data?.sheetsExpected})`,
    health.data?.sheetsPresent === health.data?.sheetsExpected,
    "run setupDatabase() in the Apps Script editor"
  );
  check("APPS_SCRIPT_SECRET set as a script property", health.data?.secretConfigured === true);

  console.log("\n=== Signature and read path ===");
  const before = await timed("snapshot.read", () => readSnapshot(env, ACTOR));
  check("signed request accepted", Array.isArray(before.value.entities.tasks));

  console.log("\n=== Write path ===");
  const write = await timed("batch.write (1 task + 1 note)", () =>
    writeBatch(env, ACTOR, [
      {
        kind: "tasks",
        obj: {
          taskId, userId: USER_ID, title: "Harness task", description: "written by sheets:test",
          priority: "HIGH", status: "OPEN", subjectId: "sub_test", enrollmentSubjectId: null,
          scheduleEntryId: null, dueDate: "2026-12-01", completedAt: null, deletedAt: null,
          createdAt: ts, updatedAt: ts,
        },
      },
      {
        kind: "notes",
        obj: {
          noteId, userId: USER_ID, title: "Harness note", body: "written by sheets:test",
          subjectId: "sub_test", enrollmentSubjectId: null, scheduleEntryId: null,
          status: "ACTIVE", deletedAt: null, createdAt: ts, updatedAt: ts,
        },
      },
    ])
  );
  check("two rows inserted", write.value.inserted === 2, JSON.stringify(write.value));

  console.log("\n=== Read back and verify mapping ===");
  const after = await timed("snapshot.read", () => readSnapshot(env, ACTOR));
  const task = after.value.entities.tasks.find((t) => t.taskId === taskId);
  const note = after.value.entities.notes.find((n) => n.noteId === noteId);

  check("task round-tripped", Boolean(task));
  check("note round-tripped", Boolean(note));
  if (task) {
    // These three are the renamed columns, so they are where a mapping bug shows.
    check("task.userId restored from ownerUserId", task.userId === USER_ID, String(task.userId));
    check("task.status restored from taskStatus", task.status === "OPEN", String(task.status));
    check("task.dueDate restored from dueAt", String(task.dueDate).startsWith("2026-12-01"), String(task.dueDate));
    check("task.subjectId restored from extraJson", task.subjectId === "sub_test", String(task.subjectId));
    check("title preserved", task.title === "Harness task", String(task.title));
  }
  if (note) {
    check("note.status restored from noteStatus", note.status === "ACTIVE", String(note.status));
    check("note body preserved", note.body === "written by sheets:test", String(note.body));
  }

  console.log("\n=== Ownership enforcement ===");
  try {
    await callAction(env, "batch.write", { googleSub: "test-harness-999", email: "other@localhost" }, {
      ops: [{ kind: "tasks", id: taskId, row: { taskId, title: "Should be rejected" } }],
    });
    check("another user cannot write this task", false, "the write was accepted");
  } catch (error) {
    check(`another user cannot write this task (${error.code})`, error.code === "FORBIDDEN", error.message);
  }

  console.log("\n=== Cleanup ===");
  const cleanup = await timed("batch.write (remove test rows)", () =>
    writeBatch(env, ACTOR, [
      { kind: "tasks", id: taskId, remove: true },
      { kind: "notes", id: noteId, remove: true },
    ])
  );
  check("test rows removed", cleanup.value.removed === 2, JSON.stringify(cleanup.value));

  const budget = before.ms + write.ms;
  console.log(`\nTypical request cost: ${before.ms}ms hydrate + ${write.ms}ms flush = ${budget}ms`);
  if (budget > 6000) {
    console.log("That is slow for a page load. Trim rows or move to a real database (DATABASE.md section 20).");
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed. Persistence is live.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  reportError(error);
  console.error("\nCould not complete the test. Check that the web app is deployed with access set to Anyone,");
  console.error("that APPS_SCRIPT_SECRET matches on both sides, and that setupDatabase() has been run.");
  process.exit(1);
});
