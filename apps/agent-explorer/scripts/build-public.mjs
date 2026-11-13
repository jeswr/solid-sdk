// AUTHORED-BY Claude Fable 5.2
// Builds the public copy of the explorer: the same static files, with a data bundle that
// leaves out the team's working roadmap. The output directory can be served by any static
// host. Usage: node scripts/build-public.mjs <out-dir>
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist-public'));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'data'), { recursive: true });
for (const f of ['index.html', 'styles.css', 'js']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
execFileSync(process.execPath, [join(root, 'scripts/bundle-data.mjs')], {
  env: { ...process.env, AX_PUBLIC: '1', AX_BUNDLE_OUT: join(out, 'data/bundle.js') },
  stdio: 'inherit',
});
console.log(`wrote ${out}`);
