// Bundle the game into dist/ with esbuild.
//
// One entry point. The red-team battery is imported as JSON, so the site is a
// handful of static files with no runtime fetches.

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, 'css'), { recursive: true });

const result = await build({
  entryPoints: { app: path.join(src, 'js/app.js') },
  outdir: path.join(dist, 'js'),
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

await fs.copyFile(path.join(src, 'index.html'), path.join(dist, 'index.html'));
await fs.copyFile(path.join(src, 'css/style.css'), path.join(dist, 'css/style.css'));
await fs.writeFile(path.join(dist, '.nojekyll'), '');

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  console.log(`  ${path.relative(root, file).padEnd(24)} ${(info.bytes / 1024).toFixed(0)} KB`);
}
console.log('built dist/');
