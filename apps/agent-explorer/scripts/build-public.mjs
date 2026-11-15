// AUTHORED-BY Claude Fable 5.2
// AUTHORED-BY Codex GPT-6
// Builds the public copy of the explorer: the same static files, with a data bundle that
// leaves out the team's working roadmap. The output directory can be served by any static
// host. Usage: [AX_APP_DIR=<prebuilt app>] node scripts/build-public.mjs <out-dir>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printSizeReport } from './site-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist-public'));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'data'), { recursive: true });
for (const f of ['index.html', 'styles.css', 'js']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
// The walkthrough video is not committed (see media/README.md); copy it when present.
if (existsSync(join(root, 'media'))) cpSync(join(root, 'media'), join(out, 'media'), { recursive: true });
// The Errand consumer app (apps/agent-chat), when a prebuilt copy is given, is hosted at app/.
// Build it with relative asset paths first (pnpm --filter @jeswr/app-agent-chat build:artifact)
// and pass its output folder: AX_APP_DIR=<path>/apps/agent-chat/dist-artifact.
const appDir = process.env.AX_APP_DIR && resolve(process.env.AX_APP_DIR);
if (appDir) {
  if (!existsSync(join(appDir, 'index.html'))) throw new Error(`AX_APP_DIR has no index.html: ${appDir}`);
  cpSync(appDir, join(out, 'app'), { recursive: true });
  console.log(`copied the app from ${appDir} to app/`);
}
execFileSync(process.execPath, [join(root, 'scripts/bundle-data.mjs')], {
  env: { ...process.env, AX_PUBLIC: '1', AX_BUNDLE_OUT: join(out, 'data/bundle.js') },
  stdio: 'inherit',
});
console.log(`wrote ${out}`);
printSizeReport(out);
