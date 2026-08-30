import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestGet as googleCallback } from "../functions/api/google/callback.js";
import { onRequestGet as googleConnect } from "../functions/api/google/connect.js";
import { onRequestPost as googleDisconnect } from "../functions/api/google/disconnect.js";
import { onRequestPost as googlePreferences } from "../functions/api/google/preferences.js";
import { onRequestGet as googleStatus } from "../functions/api/google/status.js";
import { onRequestGet as googleUpdates } from "../functions/api/google/updates.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT || 8788);
const HOST = "127.0.0.1";

const API_ROUTES = new Map([
  ["GET /api/google/callback", googleCallback],
  ["GET /api/google/connect", googleConnect],
  ["POST /api/google/disconnect", googleDisconnect],
  ["POST /api/google/preferences", googlePreferences],
  ["GET /api/google/status", googleStatus],
  ["GET /api/google/updates", googleUpdates]
]);

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

async function loadDevVars() {
  try {
    const text = await readFile(resolve(ROOT, ".dev.vars"), "utf8");
    const values = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch (_) {
    return {};
  }
}

const env = { ...process.env, ...await loadDevVars() };

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch (_) {
    return false;
  }
}

function corsHeaders(request, headers) {
  const origin = request.headers.get("Origin");
  if (isLocalOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.append("Vary", "Origin");
  }
  return headers;
}

async function nodeRequest(req) {
  const origin = `http://${req.headers.host || `${HOST}:${PORT}`}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) chunks.push(chunk);
  }
  return new Request(new URL(req.url || "/", origin), {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined
  });
}

async function sendWebResponse(res, response, request) {
  const headers = corsHeaders(request, new Headers(response.headers));
  res.writeHead(response.status, Object.fromEntries(headers.entries()));
  if (!response.body) return res.end();
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = resolve(ROOT, "." + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return null;
  const relative = filePath.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (!relative || relative.startsWith(".") || relative.startsWith("functions/") || relative.startsWith("node_modules/")) return null;
  return filePath;
}

async function serveStatic(req, res, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  try {
    const content = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=0"
    });
    res.end(content);
  } catch (_) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const request = await nodeRequest(req);
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/google/")) {
      return sendWebResponse(res, new Response(null, { status: 204 }), request);
    }
    if (url.pathname === "/api/dev/health") {
      return sendWebResponse(res, Response.json({ status: "OK", functions: true }), request);
    }

    const handler = API_ROUTES.get(`${request.method} ${url.pathname}`);
    if (handler) {
      const response = await handler({ request, env });
      return sendWebResponse(res, response, request);
    }
    if (url.pathname.startsWith("/api/")) {
      return sendWebResponse(res, Response.json({ status: "NOT_FOUND", error: "API route not found." }, { status: 404 }), request);
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ERROR", error: String(error && error.message || error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`My-Schedule development server: http://${HOST}:${PORT}`);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_SESSION_SECRET) {
    console.log("Google OAuth is not configured. Add real values to .dev.vars.");
  }
});
