// AUTHORED-BY Claude Opus 5.5
// Fails when any file of a public site build carries any roadmap text of 40 characters or more, or when
// the build holds a symbolic link (an upload would follow it). The roadmap is the team's working
// plan and is never published; checking its text, not a key name, also catches a copy that
// arrived another way (for example inside a spec or under media/). Usage:
// node scripts/check-public-bundle.mjs <site-dir or file>
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) throw new Error('usage: check-public-bundle.mjs <site-dir or file>');
const roadmap = JSON.parse(readFileSync(join(root, 'data/roadmap.json'), 'utf8'));

const texts = [];
(function walk(value) {
  if (typeof value === 'string') {
    if (value.length >= 40) texts.push(value);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walk(v);
  }
})(roadmap);
const probes = [...new Set(texts)];
if (probes.length < 3) throw new Error('the roadmap has too few long texts to check against');
const needles = probes.flatMap((t) => [t, JSON.stringify(t).slice(1, -1)]).map((t) => Buffer.from(t, 'utf8'));

const problems = [];
let files = 0;
(function scan(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    problems.push(`${path} is a symbolic link`);
  } else if (stat.isDirectory()) {
    for (const name of readdirSync(path)) scan(join(path, name));
  } else if (stat.isFile()) {
    files += 1;
    const bytes = readFileSync(path);
    if (needles.some((n) => bytes.includes(n))) problems.push(`${path} carries roadmap text`);
  } else {
    problems.push(`${path} is not a regular file`);
  }
})(target);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error('the roadmap must not be published, and the site must hold only regular files');
  process.exit(1);
}
console.log(`${target}: ${files} files, no roadmap text (${probes.length} probes), no links`);
