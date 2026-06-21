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
const TTL_SLUG = { "fedapp.ttl": "fed.ttl", "fedreg.ttl": "fedreg.ttl", "task.ttl": "task.ttl" };
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

// `slug` is the PUBLIC namespace slug / w3id route (fed, task) — NOT the source
// filename (fedapp.ttl). `ctx` is the matching JSON-LD context filename.
function htmlFor(file, slug, ctx, ttl) {
  const quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${slug}` }).parse(ttl);
  const byS = new Map();
  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    const e = byS.get(q.subject.value) ?? { types: [], label: "", comment: "" };
    if (q.predicate.value === RDF_TYPE) e.types.push(q.object.value);
    if (q.predicate.value === `${RDFS}label` && !e.label) e.label = q.object.value;
    if (q.predicate.value === `${RDFS}comment` && !e.comment) e.comment = q.object.value;
    byS.set(q.subject.value, e);
  }
  const ns = slug;
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
    <title>w3id.org/jeswr/${ns} — Solid Federation Vocabulary</title>
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
    <p>Other representations: <a href="${ns}.ttl">Turtle</a> · <a href="${ctx}">JSON-LD context</a> · <a href="./">index</a></p>
    <h2>Terms</h2>
    <table>
      <tr><th>Term</th><th>Label</th><th>Comment</th></tr>
${rows}
    </table>
  </body>
</html>
`;
}

for (const [file, slug, ctx] of [
  ["fedapp.ttl", "fed", "context.jsonld"],
  ["fedreg.ttl", "fedreg", "fedreg-context.jsonld"],
  ["task.ttl", "task", "task-context.jsonld"],
]) {
  const html = htmlFor(file, slug, ctx, readFileSync(join(ROOT, file), "utf8"));
  writeFileSync(join(DOCS, `${slug}.html`), html);
  console.log(`docs/${slug}.html (text/html conneg target)`);
}

// =============================================================================
// 5 — SECTOR ONTOLOGIES (gUFO Core + the 9 sectors). Served from docs/sectors/
// (+ docs/core.*) so the w3id routes …/core and …/sectors/<x> resolve by conneg:
//   text/turtle        -> <slug>.ttl
//   application/ld+json -> <slug>-context.jsonld
//   text/html          -> <slug>.html
// The .ttl is copied verbatim; the JSON-LD context + HTML are DERIVED from the
// parsed quads (n3) so they can never drift from the source.
// =============================================================================
const SECTORS_SRC = join(ROOT, "sectors");
const DOCS_SECTORS = join(DOCS, "sectors");
mkdirSync(DOCS_SECTORS, { recursive: true });

// [srcRel, route, prefix, ns] — route is the w3id path segment (== served slug).
const ONTOS = [
  ["sectors/core/core.ttl", "core", "core", "https://w3id.org/jeswr/core#"],
  ["sectors/identity/identity.ttl", "sectors/identity", "id", "https://w3id.org/jeswr/sectors/identity#"],
  ["sectors/finance/finance.ttl", "sectors/finance", "fin", "https://w3id.org/jeswr/sectors/finance#"],
  ["sectors/health/health.ttl", "sectors/health", "health", "https://w3id.org/jeswr/sectors/health#"],
  ["sectors/media/media.ttl", "sectors/media", "media", "https://w3id.org/jeswr/sectors/media#"],
  ["sectors/scheduling/scheduling.ttl", "sectors/scheduling", "sched", "https://w3id.org/jeswr/sectors/scheduling#"],
  ["sectors/contacts/contacts.ttl", "sectors/contacts", "contact", "https://w3id.org/jeswr/sectors/contacts#"],
  ["sectors/drawing/drawing.ttl", "sectors/drawing", "drawing", "https://w3id.org/jeswr/sectors/drawing#"],
  ["sectors/social/social.ttl", "sectors/social", "social", "https://w3id.org/jeswr/sectors/social#"],
  ["sectors/bookmarks/bookmarks.ttl", "sectors/bookmarks", "bookmark", "https://w3id.org/jeswr/sectors/bookmarks#"],
];

const RDF_LABEL = `${RDFS}label`;
const SKOS_PREFLABEL = "http://www.w3.org/2004/02/skos/core#prefLabel";
const SKOS_DEF = "http://www.w3.org/2004/02/skos/core#definition";
const OWL_CLASS = `${"http://www.w3.org/2002/07/owl#"}Class`;
const OWL_OBJ = "http://www.w3.org/2002/07/owl#ObjectProperty";
const OWL_DATA = "http://www.w3.org/2002/07/owl#DatatypeProperty";

const RDFS_RANGE = `${RDFS}range`;
const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Parse an ontology .ttl and index its OWN-namespace terms. */
function indexOntology(ttl, route, ns) {
  const quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${route}` }).parse(ttl);
  const byS = new Map();
  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    const e = byS.get(q.subject.value) ?? { types: [], label: "", comment: "", range: null };
    if (q.predicate.value === RDF_TYPE) e.types.push(q.object.value);
    if ((q.predicate.value === RDF_LABEL || q.predicate.value === SKOS_PREFLABEL) && !e.label)
      e.label = q.object.value;
    if ((q.predicate.value === `${RDFS}comment` || q.predicate.value === SKOS_DEF) && !e.comment)
      e.comment = q.object.value;
    if (q.predicate.value === RDFS_RANGE && q.object.termType === "NamedNode" && !e.range)
      e.range = q.object.value;
    byS.set(q.subject.value, e);
  }
  // own-namespace named terms (classes / properties / individuals), not the ontology node
  const terms = [...byS]
    .filter(([iri, e]) => iri.startsWith(ns) && !e.types.includes(OWL_ONTOLOGY) && e.label)
    .map(([iri, e]) => ({
      iri,
      local: iri.slice(ns.length),
      label: e.label,
      comment: e.comment,
      // object properties take IRI values; datatype properties take literals.
      isObjectProp: e.types.includes(OWL_OBJ),
      isDataProp: e.types.includes(OWL_DATA),
      range: e.range,
    }))
    .sort((a, b) => a.iri.localeCompare(b.iri));
  return terms;
}

/** A minimal JSON-LD @context for an ontology: prefix + each local term. */
function contextFor(prefix, ns, terms) {
  const ctx = {
    "@version": 1.1,
    "@protected": true,
    [prefix]: ns,
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    skos: "http://www.w3.org/2004/02/skos/core#",
    xsd: XSD,
    id: "@id",
    type: "@type",
  };
  for (const t of terms) {
    if (t.isObjectProp) {
      // object property → values are IRIs.
      ctx[t.local] = { "@id": `${prefix}:${t.local}`, "@type": "@id" };
    } else if (t.isDataProp) {
      // datatype property → values are LITERALS. Carry the declared xsd: range as
      // the @type when known; otherwise a plain term mapping (a literal, NOT @id).
      ctx[t.local] =
        t.range && t.range.startsWith(XSD)
          ? { "@id": `${prefix}:${t.local}`, "@type": `xsd:${t.range.slice(XSD.length)}` }
          : `${prefix}:${t.local}`;
    } else {
      // a class or coded-value individual → a plain prefixed term.
      ctx[t.local] = `${prefix}:${t.local}`;
    }
  }
  return { "@context": ctx };
}

/** HTML term table for an ontology (the text/html conneg target). */
function ontologyHtml(route, prefix, ns, terms, depth) {
  const up = "../".repeat(depth); // relative path back to docs/ root
  const slug = route.split("/").pop();
  const rows = terms
    .map(
      (t) =>
        `      <tr><td><code>${prefix}:${esc(t.local)}</code></td><td>${esc(t.label)}</td><td>${esc(t.comment)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>w3id.org/jeswr/${route}# — Solid Federation Sector Ontology</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 64rem; margin: 2rem auto; padding: 0 1rem; }
      code { background: rgba(127,127,127,0.15); padding: 0.1em 0.35em; border-radius: 4px; }
      .warn { border-left: 4px solid #d97706; padding: 0.5rem 1rem; background: rgba(217,119,6,0.08); border-radius: 4px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid rgba(127,127,127,0.3); vertical-align: top; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1><code>https://w3id.org/jeswr/${route}#</code></h1>
    <p>Prefix <code>${prefix}:</code> · a gUFO-based ontology in the @jeswr Solid federation; imports the <a href="${up}core.html">Solid Core</a>.</p>
    <p class="warn">⚠️ <strong>Experimental</strong> — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.</p>
    <p>Other representations: <a href="${slug}.ttl">Turtle</a> · <a href="${slug}-context.jsonld">JSON-LD context</a> · <a href="${up}">index</a></p>
    <h2>Terms (${terms.length})</h2>
    <table>
      <tr><th>Term</th><th>Label</th><th>Comment / definition</th></tr>
${rows}
    </table>
  </body>
</html>
`;
}

for (const [srcRel, route, prefix, ns] of ONTOS) {
  const ttl = readFileSync(join(ROOT, srcRel), "utf8");
  const terms = indexOntology(ttl, route, ns);
  const slug = route.split("/").pop();
  const depth = route.includes("/") ? route.split("/").length - 1 : 0;
  const destDir = route.includes("/") ? DOCS_SECTORS : DOCS;
  mkdirSync(destDir, { recursive: true });
  // a) Turtle (served verbatim)
  copyFileSync(join(ROOT, srcRel), join(destDir, `${slug}.ttl`));
  // b) JSON-LD context (derived)
  writeFileSync(
    join(destDir, `${slug}-context.jsonld`),
    JSON.stringify(contextFor(prefix, ns, terms), null, 2) + "\n",
  );
  // c) HTML term table (derived)
  writeFileSync(join(destDir, `${slug}.html`), ontologyHtml(route, prefix, ns, terms, depth));
  console.log(
    `docs/${route.includes("/") ? "sectors/" : ""}${slug}.{ttl,html,-context.jsonld} — ${terms.length} terms (served by GitHub Pages)`,
  );
}

console.log("BUILD PASSED.");
