#!/usr/bin/env node
// Deploy check: verifies Cloudflare Pages env vars reach Functions.
// Run: node scripts/check-cf-env.mjs
// Requires: CLOUDFLARE_API_TOKEN env var or wrangler login

const PROJECT = "qcu-schedule-web-app";

async function run(command) {
  const { execSync } = await import("node:child_process");
  return execSync(command, { encoding: "utf8", timeout: 30000 }).trim();
}

async function main() {
  console.log(`\n=== Cloudflare Pages Env Check: ${PROJECT} ===\n`);

  // 1. List Pages projects
  try {
    const projects = await run("npx wrangler pages project list --json 2>nul");
    const list = JSON.parse(projects);
    const match = list.find(p => p.name === PROJECT);
    if (match) {
      console.log(`[OK] Project "${PROJECT}" found`);
      console.log(`     Subdomain: ${match.subdomain}`);
      console.log(`     Created: ${match.created_on}`);
    } else {
      console.log(`[FAIL] Project "${PROJECT}" not found in your account`);
      console.log(`       Available projects: ${list.map(p => p.name).join(", ")}`);
      return;
    }
  } catch (e) {
    console.log("[WARN] Could not list projects (not logged in?)");
    console.log("       Run: npx wrangler login");
    console.log("       Or set: CLOUDFLARE_API_TOKEN=...");
    console.log(`       Error: ${e.message?.slice(0, 200)}`);
  }

  // 2. List secrets
  try {
    const secrets = await run(`npx wrangler pages secret list --project-name=${PROJECT} --json 2>nul`);
    const list = JSON.parse(secrets);
    console.log(`\nSecrets/vars on "${PROJECT}":`);
    for (const s of list) {
      console.log(`  ${s.name} = ${s.type === "secret_text" ? "[encrypted]" : s.value || "[empty]"}`);
    }
  } catch (e) {
    console.log("\n[WARN] Could not list secrets (not logged in?)");
    console.log(`       Error: ${e.message?.slice(0, 200)}`);
  }

  // 3. List deployments
  try {
    const deploys = await run(`npx wrangler pages deployment list --project-name=${PROJECT} --json 2>nul`);
    const list = JSON.parse(deploys);
    console.log(`\nRecent deployments for "${PROJECT}":`);
    for (const d of list.slice(0, 3)) {
      console.log(`  ${d.created_on} | ${d.source || "unknown"} | ${d.url}`);
    }
  } catch (e) {
    console.log("\n[WARN] Could not list deployments");
    console.log(`       Error: ${e.message?.slice(0, 200)}`);
  }

  // 4. Hit the health endpoint
  console.log(`\nHitting https://${PROJECT}.pages.dev/api/v1/health ...`);
  try {
    const resp = await fetch(`https://${PROJECT}.pages.dev/api/v1/health`);
    const data = await resp.json();
    console.log("Response:", JSON.stringify(data, null, 2));
    if (data.env?.GOOGLE_CLIENT_ID === "MISSING") {
      console.log("\n[FAIL] GOOGLE_CLIENT_ID not reaching Functions!");
      console.log("       The env vars are set in the dashboard but Functions can't see them.");
      console.log("       Possible causes:");
      console.log("       1. Vars set on wrong project — check you're editing the right one");
      console.log("       2. Need to redeploy after setting vars");
      console.log("       3. Functions not deployed (check Deployments tab)");
    } else if (data.env?.GOOGLE_CLIENT_ID === "set") {
      console.log("\n[OK] All env vars reaching Functions correctly!");
    }
  } catch (e) {
    console.log(`[WARN] Could not reach health endpoint: ${e.message?.slice(0, 200)}`);
  }

  console.log("");
}

main().catch(e => { console.error(e); process.exit(1); });
