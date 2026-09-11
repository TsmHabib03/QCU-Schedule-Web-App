// Push the canonical academic catalog into the Google Sheets workbook.
//
//   npm run sheets:sync-catalog
//
// The app reads its catalog from the bundled copy in
// functions/api/repo/catalog-seed.js, so this does not feed the runtime. It
// exists so the spreadsheet's admin view shows the same campuses, departments,
// programs, terms, subjects, buildings and rooms the app is using, instead of a
// hand-maintained copy that drifts.
//
// Rows are upserted by primary key. Anything the catalog no longer lists is
// marked INACTIVE rather than deleted, so older foreign keys still resolve.

import { syncCatalog } from "../functions/api/repo/sheets-adapter.js";
import { MAINTENANCE_ACTOR, loadCatalog, loadEnv, reportError } from "./_sheets-client.mjs";

// data/academic-catalog.json uses the app's own field names, which already match
// the sheet columns for these entities.
function toCatalogPayload(catalog) {
  return {
    version: catalog.version ?? null,
    campuses: catalog.campuses || [],
    departments: catalog.departments || [],
    programs: catalog.programs || [],
    terms: catalog.terms || [],
    subjects: catalog.subjects || [],
    buildings: catalog.buildings || [],
    rooms: catalog.rooms || [],
  };
}

async function main() {
  const env = await loadEnv();
  const catalog = await loadCatalog();
  const payload = toCatalogPayload(catalog);

  console.log("\nSyncing academic catalog to Google Sheets");
  console.log(`  catalog version: ${payload.version ?? "unset"}`);
  for (const [entity, rows] of Object.entries(payload)) {
    if (Array.isArray(rows)) console.log(`  ${entity.padEnd(12)} ${rows.length} row(s)`);
  }

  const result = await syncCatalog(env, MAINTENANCE_ACTOR, payload);

  console.log("\nApps Script applied:");
  for (const [entity, counts] of Object.entries(result.synced || {})) {
    console.log(
      `  ${entity.padEnd(12)} received ${counts.received}, inserted ${counts.inserted}, retired ${counts.retired}`
    );
  }
  console.log("\nDone.");
}

main().catch((error) => {
  reportError(error);
  console.error("\nCatalog sync failed. Confirm setupDatabase() has been run in the Apps Script editor.");
  process.exit(1);
});
