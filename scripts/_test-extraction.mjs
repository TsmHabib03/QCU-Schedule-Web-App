// End-to-end Gemini extraction test using the real prompt and a synthetic COR image.
import { readFileSync } from 'node:fs';
import { extractWithGemini, geminiResultToDraft, GEMINI_MODELS } from '../functions/api/v1/cor/_gemini.js';

// Read GEMINI_API_KEY straight from .dev.vars (loadEnv does not expose it).
const key = readFileSync('.dev.vars', 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) { console.error('No GEMINI_API_KEY in .dev.vars'); process.exit(1); }

// 1x1 white PNG (valid PNG header) — extraction will find no data, but this
// proves the model + parsing path works end to end without crashing.
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const bytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));

console.log('models:', GEMINI_MODELS.join(', '));
const start = Date.now();
try {
  const result = await extractWithGemini(bytes, 'image/png', key);
  console.log(`extraction ok in ${Date.now() - start}ms`);
  const draft = geminiResultToDraft(result);
  console.log('draft built. studentNumber:', JSON.stringify(draft.studentInfo.studentNumber), '| subjects:', draft.subjects.length);
  console.log('PASS: full pipeline (model call -> JSON parse -> draft conversion)');
} catch (e) {
  console.log(`FAILED in ${Date.now() - start}ms: ${e.message}`);
  process.exit(1);
}
