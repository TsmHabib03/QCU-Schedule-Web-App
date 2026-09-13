// Read-only compatibility check. Never authenticates as an administrator.
import { loadEnv } from './_sheets-client.mjs';
import { callAction } from '../functions/api/repo/sheets-adapter.js';

const env = await loadEnv();
const actor = { googleSub: 'configuration-check-read-only', email: '' };
let failed = false;
try {
  const url = new URL(env.APPS_SCRIPT_URL);
  url.searchParams.set('action', 'health');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const health = await response.json();
  const version = Number(health.meta?.schemaVersion || 0);
  if (version < 3 || health.data?.status !== 'healthy') {
    failed = true;
    console.error(`Published schema version: ${version}; required: 3. Database status: ${health.data?.status || 'unknown'}.`);
  } else console.log('Published schema v3 is current and all required sheets/columns are present.');
} catch (_) {
  failed = true;
  console.error('Could not read Apps Script deployment health. Check the URL and web-app access settings.');
}
for (const action of ['admin.access', 'admin.users.list', 'admin.user.read', 'admin.user.update']) {
  try {
    await callAction(env, action, actor, {});
    failed = true;
    console.error(`${action}: unexpected access for a non-admin identity. Do not use this deployment.`);
  } catch (error) {
    if (error.code === 'FORBIDDEN') {
      console.log(`${action}: available; non-admin access correctly rejected.`);
    } else {
      failed = true;
      console.error(`${action}: ${error.code || 'CONNECTION_ERROR'}`);
      if (error.code === 'NOT_FOUND') {
        console.error('The published deployment is missing this admin command.');
      } else {
        console.error('Check the deployment URL and matching signing-secret configuration.');
      }
    }
  }
}
if (failed) {
  console.error('\nReplace the entire Apps Script Code.gs with setup-database.gs.');
  console.error('Save, run setupDatabase(), then Deploy > Manage deployments > Edit > New version > Deploy.');
  console.error('Editing/saving code or running setupDatabase() alone does not update an existing /exec deployment.');
  process.exitCode = 1;
} else {
  console.log('\nPublished admin commands are available. Restart npm run dev and sign in again.');
  console.log('This verifies API compatibility and non-admin rejection, not a real admin login.');
}
