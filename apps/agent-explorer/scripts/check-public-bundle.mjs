// AUTHORED-BY Claude Opus 5.5
// Fails when a public data bundle carries any of the roadmap's longest texts. The roadmap is the
// team's working plan and is never published; checking its text, not a key name, also catches a
// copy that arrived another way (for example inside a spec). Usage:
// node scripts/check-public-bundle.mjs <site>/data/bundle.js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = process.argv[2];
if (!bundlePath) throw new Error('usage: check-public-bundle.mjs <bundle.js>');
const bundle = readFileSync(bundlePath, 'utf8');
const roadmap = JSON.parse(readFileSync(join(root, 'data/roadmap.json'), 'utf8'));

const texts = [];
(function walk(value) {
  if (typeof value === 'string') {
    if (value.length >= 40) texts.push(value);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walk(v);
  }
})(roadmap);
texts.sort((a, b) => b.length - a.length);
const probes = texts.slice(0, 5);
if (probes.length < 3) throw new Error('the roadmap has too few long texts to check against');
const found = probes.filter((t) => bundle.includes(t) || bundle.includes(JSON.stringify(t).slice(1, -1)));
if (found.length) {
  console.error(`${bundlePath} carries ${found.length} of ${probes.length} roadmap texts; the roadmap must not be published`);
  process.exit(1);
}
console.log(`${bundlePath}: no roadmap text (${probes.length} probes)`);
