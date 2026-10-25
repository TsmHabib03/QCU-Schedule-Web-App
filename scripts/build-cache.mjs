import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const pages = ['index', 'schedule', 'workspace', 'buildings', 'settings', 'campus-eta', 'onboarding', 'offline', 'privacy', 'terms', '404', 'admin'];
const shells = pages.filter(name => name !== 'admin' && name !== 'onboarding');
const assets = new Set(shells.map(name => '/' + name + '.html'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
for (const page of pages) {
  const file = resolve(root, page + '.html');
  const html = await readFile(file, 'utf8');
  let updated = html;
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^" ]*)?"/g)];
  for (const ref of refs) {
    const path = ref[1];
    const bytes = await readFile(resolve(root, path));
    const versioned = /\.(js|css)$/.test(path) ? path + '?v=' + hash(bytes) : path;
    updated = updated.replaceAll(ref[0], ref[0].replace(/".*"$/, '"' + versioned + '"'));
    if (shells.includes(page)) assets.add('/' + versioned);
  }
  if (updated !== html) await writeFile(file, updated);
}
assets.add('/assets/fonts/public-sans-latin-wght-normal.woff2');
// The authenticated header inserts this image from app.js, so it is not found
// among the static HTML references after the public login view is rendered.
assets.add('/assets/images/Quezon_City_Government.png');
assets.add('/manifest.json');
const ordered = [...assets].sort();
const digest = createHash('sha256');
const hashes = {};
for (const path of ordered) {
  const bytes = await readFile(resolve(root, path.slice(1).split('?')[0]));
  hashes[path] = hash(bytes);
  digest.update(path); digest.update(bytes);
}
const template = await readFile(resolve(root, 'scripts/service-worker.template.js'), 'utf8');
digest.update(template);
const manifest = `const RELEASE = ${JSON.stringify(digest.digest('hex').slice(0, 16))};\nconst PAGES = ${JSON.stringify(shells.map(name => '/' + name + '.html'))};\nconst ASSETS = ${JSON.stringify(ordered, null, 2)};\nconst HASHES = ${JSON.stringify(hashes, null, 2)};`;
await writeFile(resolve(root, 'service-worker.js'), template.replace('/* MANIFEST */', manifest));
console.log(`Generated service worker: ${shells.length} pages, ${ordered.length} files, content-versioned assets.`);
