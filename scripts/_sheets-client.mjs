// Shared helper for the Sheets maintenance scripts.
//
// Loads APPS_SCRIPT_URL / APPS_SCRIPT_SECRET from the process environment or
// .dev.vars, and reuses the Functions adapter so these scripts sign requests
// with exactly the same code path production uses. If signing ever drifts, it
// drifts for both at once instead of only being caught in production.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..");

/** Parse .dev.vars — KEY=value or KEY="value", # comments ignored. */
async function readDevVars() {
  try {
    const text = await readFile(resolve(repoRoot, ".dev.vars"), "utf8");
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.length > 1 && value[0] === '"' && value.endsWith('"')) value = value.slice(1, -1);
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Build the env object the adapter expects.
 * Exits with a usable message rather than a stack trace when unconfigured.
 */
export async function loadEnv() {
  const devVars = await readDevVars();
  const env = {
    APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL || devVars.APPS_SCRIPT_URL || "",
    APPS_SCRIPT_SECRET: process.env.APPS_SCRIPT_SECRET || devVars.APPS_SCRIPT_SECRET || "",
  };

  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`\nMissing ${missing.join(" and ")}.\n`);
    console.error("Set them in .dev.vars (see .dev.vars.example) or in your shell:");
    console.error('  APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec"');
    console.error('  APPS_SCRIPT_SECRET="the same value as the Apps Script property"\n');
    process.exit(1);
  }

  return env;
}

/**
 * The actor every script signs as. Apps Script derives ownership from
 * googleSub, so a dedicated maintenance identity keeps script-written rows
 * clearly separate from any real student's data.
 */
export const MAINTENANCE_ACTOR = {
  googleSub: "script-maintenance",
  email: "maintenance@localhost",
};

export async function loadCatalog() {
  const text = await readFile(resolve(repoRoot, "data/academic-catalog.json"), "utf8");
  return JSON.parse(text);
}

/** Print a SheetsError (or anything else) without a wall of stack trace. */
export function reportError(error) {
  if (error && error.code) {
    console.error(`\n[${error.code}] ${error.message}`);
    if (error.fields) console.error(JSON.stringify(error.fields, null, 2));
  } else {
    console.error(`\n${error?.message || error}`);
  }
}
