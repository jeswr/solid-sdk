// AUTHORED-BY Claude Fable 5.2
// AUTHORED-BY Codex GPT-6
// Builds a copy of the explorer that can be published as a hosted page whose host wraps the
// file in its own document skeleton: the output index.html has no doctype, html, head or body
// tags, only the title, metas, stylesheet link and the body content. All other files are
// copied unchanged.
// Usage: node scripts/build-artifact.mjs <out-dir>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printSizeReport } from './site-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist-artifact'));
const html = readFileSync(join(root, 'index.html'), 'utf8');

const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
if (!body) throw new Error('index.html has no body');
const keep = head
  .split('\n')
  .filter((l) => /<title>|name="claude:|name="description"|rel="stylesheet"/.test(l))
  .join('\n');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), `${keep}\n${body.trim()}\n`);
for (const f of ['styles.css', 'js', 'data/bundle.js', 'data/traces']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
console.log(`wrote ${out}`);
printSizeReport(out);
