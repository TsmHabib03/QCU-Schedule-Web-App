import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/configure-google-oauth.mjs <client_secret.json>");
  process.exit(1);
}

const source = JSON.parse(await readFile(resolve(sourcePath), "utf8"));
const credentials = source.web || source.installed;

if (!credentials || !credentials.client_id || !credentials.client_secret) {
  console.error("The selected JSON file does not contain Google OAuth client credentials.");
  process.exit(1);
}

if (!source.web) {
  console.error("This OAuth client is not a Web application client. Create a Web application OAuth client in Google Cloud Console.");
  process.exit(1);
}

const sessionSecret = randomBytes(48).toString("base64url");
const escapeValue = value => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const output = [
  `GOOGLE_CLIENT_ID="${escapeValue(credentials.client_id)}"`,
  `GOOGLE_CLIENT_SECRET="${escapeValue(credentials.client_secret)}"`,
  `GOOGLE_SESSION_SECRET="${sessionSecret}"`,
  ""
].join("\n");

await writeFile(resolve(".dev.vars"), output, { encoding: "utf8", mode: 0o600 });

const requiredRedirect = "http://127.0.0.1:8788/api/google/callback";
const redirects = Array.isArray(credentials.redirect_uris) ? credentials.redirect_uris : [];
console.log("Created .dev.vars with Google OAuth credentials and a generated session secret.");
console.log(redirects.includes(requiredRedirect)
  ? "Local redirect URI is present in the downloaded OAuth client."
  : `Add this Authorized redirect URI in Google Cloud Console: ${requiredRedirect}`);
