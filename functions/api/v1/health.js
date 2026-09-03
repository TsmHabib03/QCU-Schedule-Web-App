// GET /api/v1/health
// Diagnostic endpoint: confirms env vars reach Cloudflare Functions.
// Returns presence (not values) of required env vars.
// SAFE: never exposes secret values, only true/false.

export async function onRequestGet(context) {
  const env = context.env || {};
  const has = (name) => Boolean(env[name]);
  const mask = (name) => has(name) ? "set" : "MISSING";

  const sheetsReady = has("APPS_SCRIPT_URL") && has("APPS_SCRIPT_SECRET");

  return new Response(JSON.stringify({
    status: "OK",
    env: {
      GOOGLE_CLIENT_ID: mask("GOOGLE_CLIENT_ID"),
      GOOGLE_CLIENT_SECRET: mask("GOOGLE_CLIENT_SECRET"),
      GOOGLE_SESSION_SECRET: mask("GOOGLE_SESSION_SECRET"),
      GOOGLE_PUBLIC_ORIGIN: env.GOOGLE_PUBLIC_ORIGIN || "MISSING",
      GEMINI_API_KEY: mask("GEMINI_API_KEY"),
      APPS_SCRIPT_URL: mask("APPS_SCRIPT_URL"),
      APPS_SCRIPT_SECRET: mask("APPS_SCRIPT_SECRET"),
    },
    // "sheets" means student data is written to the Google Sheets workbook.
    // "memory" means it lives only for the duration of one request, which is
    // correct for local development and data loss anywhere else.
    persistence: sheetsReady ? "sheets" : "memory",
    origin: new URL(context.request.url).origin,
    timestamp: new Date().toISOString(),
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
