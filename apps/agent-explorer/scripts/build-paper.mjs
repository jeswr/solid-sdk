// AUTHORED-BY Claude Opus 5.5
// Builds paper/index.html, the public pre-publication page of the paper, from paper/paper.md
// and paper/template.html. Needs pandoc on the PATH; the output is committed, so the public
// build (scripts/build-public.mjs) does not. Usage: node scripts/build-paper.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'paper');
const md = readFileSync(join(dir, 'paper.md'), 'utf8');
let html = execFileSync('pandoc', ['--from=markdown', '--to=html5', '--wrap=none'], {
  input: md,
  encoding: 'utf8',
});

// Tables scroll sideways on a phone instead of widening the page; table 1's dots are centred.
html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
html = html.replace(/<td>●<\/td>/g, '<td class="mark" aria-label="yes">●</td>');

// Number the references and link each in-text citation such as [21, 26] to its entry.
const at = html.indexOf('<h2 id="references">');
if (at < 0) throw new Error('paper.md has no "## References" heading');
let body = html.slice(0, at);
let refs = html.slice(at);
let n = 0;
refs = refs.replace(/<li>/g, () => `<li id="ref-${++n}">`);
body = body.replace(/\[(\d+(?:, \d+)*)\]/g, (_, list) =>
  `[${list.split(', ').map((k) => {
    if (Number(k) < 1 || Number(k) > n) throw new Error(`citation [${k}] has no reference`);
    return `<a class="cite" href="#ref-${k}">${k}</a>`;
  }).join(', ')}]`);

const template = readFileSync(join(dir, 'template.html'), 'utf8');
if (template.split('{{BODY}}').length !== 2) throw new Error('template.html needs exactly one {{BODY}}');
// The source's own comments (authorship, provenance) stay in paper.md, not in the article.
const article = (body + refs).replace(/<!--[\s\S]*?-->\n?/g, '');
const out = template.replace('{{BODY}}', () => article);
writeFileSync(join(dir, 'index.html'), out);
console.log(`wrote paper/index.html (${out.length} bytes, ${n} references)`);
