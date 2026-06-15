// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Build the served artifacts. The vocabulary source files (*.ttl + *.jsonld) are
// served verbatim from docs/ by GitHub Pages; this build step:
//   1. parses each .ttl with n3.Parser,
//   2. re-serialises the merged graph through n3.Writer (a single canonical
//      N-Triples dump at dist/vocab.nt) — the round-trip proves the source
//      parses AND that we go through the typed RDF writer, never string-concat,
//   3. copies the source vocab files into docs/ so Pages serves them at the
//      w3id redirect target.
//
// RDF goes through n3 only (suite house rule: never a bespoke serialiser).

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Parser, Writer } from "n3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DOCS = join(ROOT, "docs");
mkdirSync(DIST, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const ttlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".ttl"));
const jsonldFiles = readdirSync(ROOT).filter((f) => f.endsWith(".jsonld"));

// 1 + 2 — parse all Turtle, re-serialise via n3.Writer.
const allQuads = [];
for (const file of ttlFiles) {
  const quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${file}` }).parse(
    readFileSync(join(ROOT, file), "utf8"),
  );
  allQuads.push(...quads);
}

const ntWriter = new Writer({ format: "N-Triples" });
ntWriter.addQuads(allQuads);
await new Promise((resolve, reject) => {
  ntWriter.end((err, result) => {
    if (err) return reject(err);
    writeFileSync(join(DIST, "vocab.nt"), result);
    resolve();
  });
});
console.log(`dist/vocab.nt — ${allQuads.length} triples (n3.Writer)`);

// 3 — copy served sources into docs/. The Turtle is also published under the
// namespace-slug name (fed.ttl / task.ttl) so the served path matches the IRI
// the w3id redirect resolves (…/fed → fed.ttl). The descriptive source name
// (fedapp.ttl) is kept too for humans browsing the repo.
const TTL_SLUG = { "fedapp.ttl": "fed.ttl", "task.ttl": "task.ttl" };
for (const file of ttlFiles) {
  copyFileSync(join(ROOT, file), join(DOCS, file));
  const slug = TTL_SLUG[file];
  if (slug && slug !== file) copyFileSync(join(ROOT, file), join(DOCS, slug));
  console.log(`docs/${file}${slug && slug !== file ? ` (+ docs/${slug})` : ""} (served by GitHub Pages)`);
}
for (const file of jsonldFiles) {
  copyFileSync(join(ROOT, file), join(DOCS, file));
  console.log(`docs/${file} (served by GitHub Pages)`);
}

// 4 — generate an HTML term table per ontology (the text/html conneg target),
// derived from the parsed quads so it can never drift from the source.
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_ONTOLOGY = "http://www.w3.org/2002/07/owl#Ontology";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function htmlFor(file, ttl) {
  const quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${file}` }).parse(ttl);
  const byS = new Map();
  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    const e = byS.get(q.subject.value) ?? { types: [], label: "", comment: "" };
    if (q.predicate.value === RDF_TYPE) e.types.push(q.object.value);
    if (q.predicate.value === `${RDFS}label` && !e.label) e.label = q.object.value;
    if (q.predicate.value === `${RDFS}comment` && !e.comment) e.comment = q.object.value;
    byS.set(q.subject.value, e);
  }
  const ont = [...byS].find(([, e]) => e.types.includes(OWL_ONTOLOGY));
  const ns = file.replace(".ttl", "");
  const rows = [...byS]
    .filter(([, e]) => !e.types.includes(OWL_ONTOLOGY) && e.label)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([iri, e]) =>
        `      <tr><td><code>${esc(iri.split("#")[1] ?? iri)}</code></td><td>${esc(e.label)}</td><td>${esc(e.comment)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(ont?.[1].comment ? ns : ns)} — w3id.org/jeswr/${ns}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
      code { background: rgba(127,127,127,0.15); padding: 0.1em 0.35em; border-radius: 4px; }
      .warn { border-left: 4px solid #d97706; padding: 0.5rem 1rem; background: rgba(217,119,6,0.08); border-radius: 4px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid rgba(127,127,127,0.3); vertical-align: top; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1><code>https://w3id.org/jeswr/${ns}#</code></h1>
    <p class="warn">⚠️ <strong>Experimental</strong> — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.</p>
    <p>Other representations: <a href="${ns}.ttl">Turtle</a> · <a href="${ns === "fedapp" ? "context" : "task-context"}.jsonld">JSON-LD context</a> · <a href="./">index</a></p>
    <h2>Terms</h2>
    <table>
      <tr><th>Term</th><th>Label</th><th>Comment</th></tr>
${rows}
    </table>
  </body>
</html>
`;
}

for (const [file, slug] of [["fedapp.ttl", "fed"], ["task.ttl", "task"]]) {
  const html = htmlFor(file, readFileSync(join(ROOT, file), "utf8"));
  writeFileSync(join(DOCS, `${slug}.html`), html);
  console.log(`docs/${slug}.html (text/html conneg target)`);
}

console.log("BUILD PASSED.");
