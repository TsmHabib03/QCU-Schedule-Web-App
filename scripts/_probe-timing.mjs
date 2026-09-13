// Time signed snapshot.read against BOTH Apps Script deployments.
import { loadEnv } from './_sheets-client.mjs';
import { callAction } from '../functions/api/repo/sheets-adapter.js';

const env = await loadEnv();
const urls = {
  new: 'https://script.google.com/macros/s/AKfycbxT7OPntJl2B_kJPMLuVqxHI2sUQGdtL9M1IRMtVdj9nBCZqj1KTbj2cVrZzfqaP0Xggw/exec',
  old: 'https://script.google.com/macros/s/AKfycbx6Sqm60qDBVvGEob-P7afIXSgurWdjWoxGHTLrbX4qwItGhxEJmHxtA_GaNAMawyQJxw/exec',
};
const actor = { googleSub: 'probe-timing', email: 'probe@example.test', emailVerified: true, issuedAt: Date.now() };
for (const [name, url] of Object.entries(urls)) {
  for (let i = 1; i <= 2; i++) {
    const start = Date.now();
    try {
      await callAction({ ...env, APPS_SCRIPT_URL: url }, 'snapshot.read', actor, { kinds: ['users'] });
      console.log(`${name} attempt ${i}: ok ${Date.now() - start}ms`);
    } catch (e) {
      console.log(`${name} attempt ${i}: FAILED ${Date.now() - start}ms — ${e.code}: ${e.message}`);
    }
  }
}
