// Read-only repository checks; no credentials, network requests, or account data.
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let checks = 0;
async function exists(path, label) {
  try { await access(path); checks++; }
  catch { throw Error(`Missing ${label}: ${path}`); }
}
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
const documents = [resolve(root, 'README.md'), ...(await walk(resolve(root, 'docs'))).filter(path => path.endsWith('.md'))];
for (const file of documents) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^\s)]+)\)|(?:src|href)="([^"<>]+)"/g)) {
    const target = match[1] || match[2];
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    await exists(resolve(dirname(file), decodeURIComponent(target.split(/[?#]/)[0])), 'documentation target');
  }
}
const pages = (await readdir(root)).filter(name => name.endsWith('.html'));
for (const file of pages) {
  const html = await readFile(resolve(root, file), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="((?:assets\/|data\/)[^"?]+)(?:\?[^" ]*)?"/g)) {
    await exists(resolve(root, match[1]), 'app asset');
  }
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
for (const icon of manifest.icons) await exists(resolve(root, icon.src.replace(/^\//, '')), 'manifest icon');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const command of Object.values(pkg.scripts)) {
  for (const match of command.matchAll(/node (scripts\/[^\s&]+)/g)) await exists(resolve(root, match[1]), 'npm script');
}
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
for (const match of readme.matchAll(/npm run ([\w:-]+)/g)) assert(pkg.scripts[match[1]], `Unknown README command: ${match[1]}`);
// Run after the build to confirm only public files are shipped.
const publicOutput = resolve(root, '.build/pages');
try { await access(publicOutput); }
catch { throw Error('Run npm run build before npm run check:project'); }
for (const path of await walk(publicOutput)) {
  assert(!/(?:^|[\\/])(?:docs|scripts|functions|node_modules|\.local|\.git|\.dev\.vars)(?:[\\/]|$)|\.(?:md|log|bak|b64)$/.test(path), `Private or source-only file in Pages output: ${path}`);
}
console.log(`PASS ${documents.length} documentation files, ${pages.length} app pages, ${checks} references, npm commands, and public build contents.`);
