// Stage only public site files. Wrangler compiles functions/ separately.
import { cp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, '.build/pages');
await mkdir(output, { recursive: true });
// Never clean a symlink or junction pointing outside this exact build directory.
if (await realpath(output) !== output) throw new Error('Unexpected Pages output path');
await rm(output, { recursive: true });
await mkdir(output, { recursive: true });

const publicFiles = (await readdir(root)).filter(name => name.endsWith('.html'));
publicFiles.push('manifest.json', 'service-worker.js', '_headers');
for (const name of publicFiles) await cp(resolve(root, name), resolve(output, name));
for (const name of ['assets', 'data']) {
  await cp(resolve(root, name), resolve(output, name), {
    recursive: true,
    filter: path => !path.endsWith('.bak') && !path.endsWith('.tailwind.css') &&
      !['.log', '.map'].includes(extname(path)),
  });
}
// Static shells contain no account data. Serve them directly from Pages' CDN;
// account checks and the server-protected admin page still run in Functions.
await writeFile(resolve(output, '_routes.json'), JSON.stringify({
  version: 1,
  include: ['/api/*', '/admin', '/admin/', '/admin.html'],
  exclude: [],
}, null, 2) + '\n');
console.log(`Staged ${publicFiles.length} public files plus assets/data in .build/pages; API and admin protection retained.`);
