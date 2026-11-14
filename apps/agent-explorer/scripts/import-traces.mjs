// AUTHORED-BY Claude Opus 5.5
// Copies real runtime traces (/mnt/project-files/aa-trace-*.json, or the folder given as the
// first argument) into traces/ without the "aa-trace-" prefix, then rebuilds data/bundle.js.
// A real trace replaces a fixture of the same name. Usage: node scripts/import-traces.mjs [dir]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || '/mnt/project-files';
if (!existsSync(src)) {
  console.error(`no such folder: ${src}`);
  process.exit(1);
}
const files = readdirSync(src).filter((f) => /^aa-trace-.+\.json$/.test(f)).sort();
let n = 0;
for (const f of files) {
  const text = readFileSync(join(src, f), 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.warn(`skip ${f}: not valid JSON (${e.message})`);
    continue;
  }
  if (data.schema !== 'agent-trace/0.1') {
    console.warn(`skip ${f}: schema is ${data.schema}`);
    continue;
  }
  const out = join(root, 'traces', f.replace(/^aa-trace-/, ''));
  writeFileSync(out, text.endsWith('\n') ? text : `${text}\n`);
  console.log(`imported ${f} -> traces/${f.replace(/^aa-trace-/, '')} (${data.events?.length ?? 0} events, core ${data.generated?.core})`);
  n++;
}
console.log(`${n} trace(s) imported`);
execFileSync(process.execPath, [join(root, 'scripts/bundle-data.mjs')], { stdio: 'inherit' });
