// GET /api/v1/cor/test-gemini
// Tests if the Gemini API key works with a simple text prompt.

import { readPlatformSession, json } from "../../auth/_lib.js";

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"];

export async function onRequestGet(context) {
  const session = await readPlatformSession(context);
  if (!session) return json({ error: "Not authenticated" }, 401);

  const apiKey = (context.env || {}).GEMINI_API_KEY;
  if (!apiKey) return json({ error: "No GEMINI_API_KEY set in Cloudflare env", keyPresent: false }, 400);

  const results = [];
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Say hello in one word." }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 20 }
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "(empty)";
        results.push({ model, status: "OK", response: text.trim() });
      } else {
        results.push({ model, status: `HTTP ${response.status}`, error: (data.error?.message || "").slice(0, 200) });
      }
    } catch (err) {
      results.push({ model, status: "ERROR", error: err.message });
    }
  }

  return json({ keyPresent: true, keyPrefix: apiKey.slice(0, 6) + "...", models: results });
}
