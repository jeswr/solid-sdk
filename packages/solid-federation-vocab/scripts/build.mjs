// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Build the served artifacts. The vocabulary source files (*.ttl + *.jsonld) are
// served verbatim from docs/ by GitHub Pages; this build step:
//   1. parses each .ttl with n3.Parser,
//   2. re-serialises the merged graph through n3.Writer (a single canonical
//      N-Triples dump at dist/vocab.nt) — the round-trip proves the source
//      parses AND that we go through the typed RDF writer, never string-concat,
//   3. copies the source vocab files into docs/ so Pages serves them at the
//      jeswr.org content-negotiation target.
//
// RDF goes through n3 only (suite house rule: never a bespoke serialiser).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Store, Writer } from "n3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DOCS = join(ROOT, "docs");
mkdirSync(DIST, { recursive: true });
mkdirSync(DOCS, { recursive: true });

// The vocabulary sources. Exclude *.shacl.ttl SHACL profile sidecars (e.g.
// fedcon.shacl.ttl): like the sector .shacl.ttl profiles they are copied VERBATIM
// as sidecars (below), never merged into the reasoned vocab.nt dump nor given their
// own HTML/context — mirroring the sectors/ convention.
const ttlFiles = readdirSync(ROOT).filter(
  (f) => f.endsWith(".ttl") && !f.endsWith(".shacl.ttl") && f !== "legacy-w3id-alignments.ttl",
);
// Mode-A compatibility is served for opt-in readers, never added to vocab.nt.
copyFileSync(join(ROOT, "legacy-w3id-alignments.ttl"), join(DOCS, "legacy-w3id-alignments.ttl"));
const jsonldFiles = readdirSync(ROOT).filter((f) => f.endsWith(".jsonld"));

// 1 + 2 — parse all Turtle, re-serialise via n3.Writer.
const allQuads = [];
for (const file of ttlFiles) {
  const quads = new Parser({ baseIRI: `https://jeswr.org/ns/${file}` }).parse(
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
// the namespace handler resolves (…/fed → fed.ttl). The descriptive source name
// (fedapp.ttl) is kept too for humans browsing the repo.
const TTL_SLUG = {
  "fedapp.ttl": "fed.ttl",
  "fedreg.ttl": "fedreg.ttl",
  "task.ttl": "task.ttl",
  "fedcon.ttl": "fedcon.ttl",
};
for (const file of ttlFiles) {
  copyFileSync(join(ROOT, file), join(DOCS, file));
  const slug = TTL_SLUG[file];
  if (slug && slug !== file) copyFileSync(join(ROOT, file), join(DOCS, slug));
  console.log(
    `docs/${file}${slug && slug !== file ? ` (+ docs/${slug})` : ""} (served by GitHub Pages)`,
  );
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
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// `slug` is the PUBLIC namespace slug / route (fed, task, fedcon) — NOT the source
// filename (fedapp.ttl). `ctx` is the matching JSON-LD context filename. `base` is
// the FULL namespace base URI WITHOUT the trailing `#` (e.g.
// "https://jeswr.org/ns/fed", or "https://jeswr.org/fedcon" for fedcon:, which is
// outside /ns/) — passed explicitly so the generated title/H1 show each vocab's
// namespace root rather than assuming the /ns/ prefix.
function htmlFor(slug, ctx, base, ttl) {
  const quads = new Parser({ baseIRI: base }).parse(ttl);
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
  // The namespace root shown in the title/H1 — the REAL base per vocabulary (jeswr.org/ns
  // for fed/fedreg/task, jeswr.org for fedcon).
  const titleBase = base.replace(/^https?:\/\//, "");
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
    <title>${titleBase} — Solid Federation Vocabulary</title>
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
    <h1><code>${base}#</code></h1>
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

// [file, slug, ctx, base] — `base` is each vocab's FULL namespace root without the
// trailing `#`. fedcon: is jeswr.org-rooted (NOT jeswr.org/ns) — see fedcon.ttl.
for (const [file, slug, ctx, base] of [
  ["fedapp.ttl", "fed", "context.jsonld", "https://jeswr.org/ns/fed"],
  ["fedreg.ttl", "fedreg", "fedreg-context.jsonld", "https://jeswr.org/ns/fedreg"],
  ["task.ttl", "task", "task-context.jsonld", "https://jeswr.org/ns/task"],
  ["fedcon.ttl", "fedcon", "fedcon-context.jsonld", "https://jeswr.org/fedcon"],
]) {
  const html = htmlFor(slug, ctx, base, readFileSync(join(ROOT, file), "utf8"));
  writeFileSync(join(DOCS, `${slug}.html`), html);
  console.log(`docs/${slug}.html (text/html conneg target)`);
  // Root-vocab SHACL profile sidecar (e.g. fedcon.shacl.ttl) — copied VERBATIM
  // alongside the vocab, the same way sector .shacl.ttl sidecars are (see the ONTOS
  // loop below), so the profile resolves at docs/<slug>.shacl.ttl.
  const shacl = file.replace(/\.ttl$/, ".shacl.ttl");
  if (existsSync(join(ROOT, shacl))) {
    copyFileSync(join(ROOT, shacl), join(DOCS, shacl));
    console.log(`docs/${shacl} (SHACL profile, served by GitHub Pages)`);
  }
}

// =============================================================================
// 5 — SECTOR ONTOLOGIES (gUFO Core + the 9 sectors). Served from docs/sectors/
// (+ docs/core.*) so the namespace routes …/core and …/sectors/<x> resolve by conneg:
//   text/turtle        -> <slug>.ttl
//   application/ld+json -> <slug>-context.jsonld
//   text/html          -> <slug>.html
// The .ttl is copied verbatim; the JSON-LD context + HTML are DERIVED from the
// parsed quads (n3) so they can never drift from the source.
// =============================================================================
const SECTORS_SRC = join(ROOT, "sectors");
const DOCS_SECTORS = join(DOCS, "sectors");
mkdirSync(DOCS_SECTORS, { recursive: true });

// [srcRel, route, prefix, ns] — route is the namespace path segment (== served slug).
const ONTOS = [
  ["sectors/core/core.ttl", "core", "core", "https://jeswr.org/ns/core#"],
  [
    "sectors/identity/identity.ttl",
    "sectors/identity",
    "id",
    "https://jeswr.org/ns/sectors/identity#",
  ],
  [
    "sectors/finance/finance.ttl",
    "sectors/finance",
    "fin",
    "https://jeswr.org/ns/sectors/finance#",
  ],
  [
    "sectors/health/health.ttl",
    "sectors/health",
    "health",
    "https://jeswr.org/ns/sectors/health#",
  ],
  [
    "sectors/health/diet/diet.ttl",
    "sectors/health/diet",
    "diet",
    "https://jeswr.org/ns/sectors/health/diet#",
  ],
  ["sectors/media/media.ttl", "sectors/media", "media", "https://jeswr.org/ns/sectors/media#"],
  [
    "sectors/scheduling/scheduling.ttl",
    "sectors/scheduling",
    "sched",
    "https://jeswr.org/ns/sectors/scheduling#",
  ],
  [
    "sectors/contacts/contacts.ttl",
    "sectors/contacts",
    "contact",
    "https://jeswr.org/ns/sectors/contacts#",
  ],
  [
    "sectors/drawing/drawing.ttl",
    "sectors/drawing",
    "drawing",
    "https://jeswr.org/ns/sectors/drawing#",
  ],
  [
    "sectors/social/social.ttl",
    "sectors/social",
    "social",
    "https://jeswr.org/ns/sectors/social#",
  ],
  [
    "sectors/bookmarks/bookmarks.ttl",
    "sectors/bookmarks",
    "bookmark",
    "https://jeswr.org/ns/sectors/bookmarks#",
  ],
  [
    "sectors/futures/futures.ttl",
    "sectors/futures",
    "fut",
    "https://jeswr.org/ns/sectors/futures#",
  ],
  [
    "sectors/collectibles/collectibles.ttl",
    "sectors/collectibles",
    "col",
    "https://jeswr.org/ns/sectors/collectibles#",
  ],
  ["sectors/equine/equine.ttl", "sectors/equine", "eq", "https://jeswr.org/ns/sectors/equine#"],
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
  const quads = new Parser({ baseIRI: `https://jeswr.org/ns/${route}` }).parse(ttl);
  const store = new Store(quads);
  const lists = store.extractLists();
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
    if (q.predicate.value === RDFS_RANGE && q.object.termType === "BlankNode" && !e.range) {
      const [head] = store.getObjects(q.object, "http://www.w3.org/2002/07/owl#unionOf", null);
      const members = head ? lists[head.value] : undefined;
      // Preserve the established compact-JSON-LD dateTime default for the widened
      // date|dateTime range. All-day values use explicit @value/@type xsd:date.
      if (
        members?.length === 2 &&
        members.every(
          (term) =>
            term.termType === "NamedNode" && [`${XSD}date`, `${XSD}dateTime`].includes(term.value),
        )
      ) {
        e.range = `${XSD}dateTime`;
      }
    }
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
  const up = "../".repeat(depth) || "./"; // relative path back to docs/ root
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
    <title>jeswr.org/ns/${route}# — Solid Federation Sector Ontology</title>
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
    <h1><code>https://jeswr.org/ns/${route}#</code></h1>
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
  // Honour the FULL namespace route path so a sub-sector (e.g. sectors/health/diet)
  // nests correctly under docs/ and its `up` depth stays right — the served
  // path is docs/<route> (minus the final slug), NOT a flattened docs/sectors/.
  const routeParts = route.split("/");
  const slug = routeParts[routeParts.length - 1];
  const depth = routeParts.length - 1;
  const destDir = join(DOCS, ...routeParts.slice(0, -1));
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
  // d) SHACL profile + Mode-A alignments (served VERBATIM alongside the vocab)
  //    so a profile's `prof:hasArtifact` constraints URL — advertised at
  //    …/sectors/<x>/<slug>.shacl.ttl — actually resolves once GitHub Pages /
  //    the namespace route is live. The source dir is that of the vocabulary .ttl.
  const srcDir = dirname(join(ROOT, srcRel));
  let extras = "";
  for (const sidecar of [`${slug}.shacl.ttl`, `${slug}-alignments.ttl`]) {
    const from = join(srcDir, sidecar);
    if (existsSync(from)) {
      copyFileSync(from, join(destDir, sidecar));
      extras += `,${sidecar}`;
    }
  }
  console.log(
    `docs/${routeParts.length > 1 ? routeParts.slice(0, -1).join("/") + "/" : ""}${slug}.{ttl,html,-context.jsonld${extras}} — ${terms.length} terms (served by GitHub Pages)`,
  );
}

console.log("BUILD PASSED.");
