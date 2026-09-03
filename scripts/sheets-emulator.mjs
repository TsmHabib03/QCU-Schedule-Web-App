// Run the Apps Script database locally, without deploying anything.
//
//   node scripts/sheets-emulator.mjs            # listens on 8791
//   PORT=9000 node scripts/sheets-emulator.mjs
//
// Serves setup-database.gs over HTTP against an in-memory spreadsheet, so the
// Functions can be pointed at it exactly as they would be at Google:
//
//   APPS_SCRIPT_URL=http://127.0.0.1:8791/exec \
//   APPS_SCRIPT_SECRET=local-emulator-secret \
//   npm run dev
//
// Useful for exercising the persistence path before the real deployment exists,
// and for reproducing a bug without touching live student data. Data lives only
// in this process: stop it and the database is gone.

import { createServer } from "node:http";
import { loadAppsScript } from "./_apps-script-emulator.mjs";
import { repoRoot } from "./_sheets-client.mjs";

const PORT = Number(process.env.PORT) || 8791;
const SECRET = process.env.APPS_SCRIPT_SECRET || "local-emulator-secret";

const gs = await loadAppsScript({ repoRoot, secret: SECRET });
gs.setupDatabase();
gs.seedCatalogData();

const server = createServer((req, res) => {
  const respond = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  };

  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    respond(200, gs.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent());
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try {
      const output = gs.doPost({ postData: { contents: body } });
      const parsed = JSON.parse(output.getContent());
      if (!parsed.ok) console.log(`  [${parsed.error?.code}] ${parsed.error?.message}`);
      respond(200, output.getContent());
    } catch (error) {
      console.error(`  Apps Script threw: ${error.message}`);
      respond(500, JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: error.message } }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nApps Script emulator: http://127.0.0.1:${PORT}/exec`);
  console.log(`Sheets: ${gs.spreadsheet.getSheets().length}   Secret: ${SECRET}`);
  console.log("\nPoint the Functions at it:");
  console.log(`  APPS_SCRIPT_URL=http://127.0.0.1:${PORT}/exec APPS_SCRIPT_SECRET=${SECRET} npm run dev\n`);
});
