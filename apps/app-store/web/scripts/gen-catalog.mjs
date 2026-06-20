// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// gen-catalog.mjs — emit the Solid App Store catalog as Linked Data BEFORE every
// build/dev (wired INLINE at the front of the `build`/`dev` scripts in package.json —
// NOT a `prebuild` lifecycle hook, which `ignore-scripts=true` would silently skip):
//
//   public/catalog.ttl     the DCAT catalog in Turtle (text/turtle)
//   public/catalog.jsonld  the SAME graph in JSON-LD (application/ld+json)
//   src/generated/catalog.json  the bundle the SPA imports (the apps.json data, copied
//                               so the SPA has a single import target alongside the LD)
//
// THE LD SHAPE (mirrors jeswr/federation-registry + solid-federation-vocab — reuse,
// not reinvent): ONE stable catalog IRI `${origin}/catalog#it` (a `dcat:Catalog`).
// Each app is BOTH a curation envelope (`dcat:CatalogRecord`: dct:issued/modified,
// lifecycle status, foaf:maker) AND points at a `schema:SoftwareApplication` (name,
// applicationCategory, description, url, image, author, free offer). The store LISTING
// is a curation claim; it LINKS to (never duplicates) the future fedreg:Membership /
// fedapp:App signed-claim layer via schema:identifier → the app's clientid.jsonld.
//
// HOUSE RULE: RDF is SERIALISED through n3.Writer (Turtle) + the jsonld library
// (JSON-LD) — NEVER hand-concatenated triples. The Turtle and JSON-LD come from the
// SAME in-memory quad array, so they cannot drift (gen-catalog.test.mjs asserts they
// parse to an isomorphic dataset).
//
// PUBLISHER WebID: a placeholder `https://id.jeswr.org/me`. // needs:user confirm —
// the maintainer's canonical WebID to stamp as dct:publisher / foaf:maker.

import { readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import n3 from "n3";
import { DEV_DEFAULT, normaliseOrigin, resolveOriginValue } from "./gen-clientid.mjs";

const { DataFactory, Writer } = n3;
const { namedNode, literal, quad } = DataFactory;

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const publicDir = resolve(webRoot, "public");
const generatedDir = resolve(webRoot, "src", "generated");
const dataFile = resolve(webRoot, "data", "apps.json");

// ── Vocab IRIs (reuse DCAT + Dublin Core + schema.org; never mint where one exists) ──
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const SCHEMA = "https://schema.org/";
const FOAF = "http://xmlns.com/foaf/0.1/";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const PREFIXES = {
  rdf: RDF,
  dcat: DCAT,
  dct: DCT,
  schema: SCHEMA,
  foaf: FOAF,
  xsd: XSD,
};

/** Placeholder publisher/maker WebID — needs:user confirm the canonical one. */
const PUBLISHER = "https://id.jeswr.org/me";

const a = namedNode(`${RDF}type`);
const xsdDateTime = (value) => literal(value, namedNode(`${XSD}dateTime`));

/**
 * Map a catalog status to a stable status IRI on the catalog document. Lifecycle is
 * a CURATION fact on the dcat:CatalogRecord (it drives whether Launch is enabled),
 * kept distinct from any signed fedreg membership status.
 */
function statusIri(origin, status) {
  return namedNode(`${origin}/catalog#status-${status}`);
}

/**
 * Build the full DCAT quad array for the catalog at `origin`, from the apps array.
 * Pure (no I/O) + exported so gen-catalog.test.mjs can assert the graph shape and
 * the Turtle/JSON-LD isomorphism without touching the filesystem.
 *
 * @param {string} origin  the deployment origin (no trailing slash).
 * @param {Array}  apps    the parsed apps.json entries.
 * @param {string} [modified]  ISO dateTime stamped as dct:modified on the catalog.
 * @returns {import("@rdfjs/types").Quad[]}
 */
export function buildCatalogQuads(origin, apps, modified = "2026-06-20T00:00:00Z") {
  const catalog = namedNode(`${origin}/catalog#it`);
  const publisher = namedNode(PUBLISHER);
  const quads = [];

  // ── The dcat:Catalog node ──
  quads.push(quad(catalog, a, namedNode(`${DCAT}Catalog`)));
  quads.push(quad(catalog, namedNode(`${DCT}title`), literal("Solid App Store")));
  quads.push(
    quad(
      catalog,
      namedNode(`${DCT}description`),
      literal("Discover and launch the Solid app suite."),
    ),
  );
  quads.push(quad(catalog, namedNode(`${DCT}publisher`), publisher));
  quads.push(quad(catalog, namedNode(`${DCT}modified`), xsdDateTime(modified)));

  for (const app of apps) {
    const rec = namedNode(`${origin}/catalog#rec-${app.id}`);
    const appNode = namedNode(`${origin}/catalog#app-${app.id}`);

    // The catalog points at each curation record.
    quads.push(quad(catalog, namedNode(`${DCAT}record`), rec));

    // ── dcat:CatalogRecord — the curation envelope (who-listed-it, lifecycle, dates) ──
    quads.push(quad(rec, a, namedNode(`${DCAT}CatalogRecord`)));
    quads.push(quad(rec, namedNode(`${DCT}issued`), xsdDateTime("2026-06-16T00:00:00Z")));
    quads.push(quad(rec, namedNode(`${DCT}modified`), xsdDateTime(modified)));
    quads.push(quad(rec, namedNode(`${FOAF}maker`), publisher));
    // Lifecycle status (live | wip | local-only | gated) — a curation fact.
    quads.push(quad(rec, namedNode(`${DCAT}status`), statusIri(origin, app.status)));
    // The record points at the software-fact node.
    quads.push(quad(rec, namedNode(`${FOAF}primaryTopic`), appNode));
    quads.push(quad(rec, namedNode(`${DCAT}resource`), appNode));

    // ── schema:SoftwareApplication — what the card renders / how it launches ──
    quads.push(quad(appNode, a, namedNode(`${SCHEMA}SoftwareApplication`)));
    quads.push(quad(appNode, namedNode(`${SCHEMA}name`), literal(app.name)));
    quads.push(quad(appNode, namedNode(`${SCHEMA}applicationCategory`), literal(app.category)));
    quads.push(quad(appNode, namedNode(`${SCHEMA}description`), literal(app.description)));
    quads.push(quad(appNode, namedNode(`${SCHEMA}author`), namedNode("https://github.com/jeswr")));
    // A free offer (every suite app is free).
    const offer = namedNode(`${origin}/catalog#offer-${app.id}`);
    quads.push(quad(appNode, namedNode(`${SCHEMA}offers`), offer));
    quads.push(quad(offer, a, namedNode(`${SCHEMA}Offer`)));
    quads.push(quad(offer, namedNode(`${SCHEMA}price`), literal("0")));
    quads.push(quad(offer, namedNode(`${SCHEMA}priceCurrency`), literal("USD")));

    // The deployed app URL (only for live/deployed apps).
    if (app.deployedUrl) {
      quads.push(quad(appNode, namedNode(`${SCHEMA}url`), namedNode(app.deployedUrl)));
      // schema:identifier → the app's own Client Identifier Document (the client_id IRI)
      // — the bridge to the federation layer (link, do not duplicate membership).
      quads.push(
        quad(
          appNode,
          namedNode(`${SCHEMA}identifier`),
          namedNode(`${app.deployedUrl}/clientid.jsonld`),
        ),
      );
    }
    // The public source repo, where one exists.
    if (app.repo) {
      quads.push(quad(appNode, namedNode(`${SCHEMA}codeRepository`), namedNode(app.repo)));
    }
  }

  return quads;
}

/** Serialise a quad array to Turtle via n3.Writer (never hand-concatenated). */
export function quadsToTurtle(quads) {
  return new Promise((res, rej) => {
    const writer = new Writer({ prefixes: PREFIXES });
    writer.addQuads(quads);
    writer.end((err, result) => (err ? rej(err) : res(result)));
  });
}

/** Serialise the SAME quad array to compacted JSON-LD via the jsonld library. */
export async function quadsToJsonLd(quads) {
  // jsonld.fromRDF takes a dataset; build N-Quads with n3 (a stable RDF interchange)
  // then expand → compact with the suite vocab context so the JSON-LD is readable and
  // carries the SAME triples as the Turtle.
  const nquads = await new Promise((res, rej) => {
    const writer = new Writer({ format: "N-Quads" });
    writer.addQuads(quads);
    writer.end((err, result) => (err ? rej(err) : res(result)));
  });
  const expanded = await jsonld.fromRDF(nquads, { format: "application/n-quads" });
  const context = {
    dcat: DCAT,
    dct: DCT,
    schema: SCHEMA,
    foaf: FOAF,
  };
  return jsonld.compact(expanded, context);
}

function readApps() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

async function main() {
  const origin = normaliseOrigin(
    resolveOriginValue({ shellEnv: process.env, devDefault: DEV_DEFAULT }),
  );
  const apps = readApps();
  const quads = buildCatalogQuads(origin, apps);

  const [turtle, jsonldDoc] = await Promise.all([quadsToTurtle(quads), quadsToJsonLd(quads)]);

  await Promise.all([
    mkdir(publicDir, { recursive: true }),
    mkdir(generatedDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(publicDir, "catalog.ttl"), turtle),
    writeFile(resolve(publicDir, "catalog.jsonld"), `${JSON.stringify(jsonldDoc, null, 2)}\n`),
    // The SPA imports apps.json directly via Vite, but we also drop a copy under
    // src/generated so the "generated bundle" home exists + is git-ignored consistently.
    writeFile(resolve(generatedDir, "catalog.json"), `${JSON.stringify(apps, null, 2)}\n`),
  ]);
  console.log(
    `gen-catalog: wrote catalog.ttl + catalog.jsonld (${apps.length} apps) for origin ${origin}`,
  );
}

// Only run when executed directly (not when imported by a test). Compare REAL paths so
// a symlinked invocation (macOS /tmp → /private/tmp) still matches.
function isInvokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(entry) === real(fileURLToPath(import.meta.url));
}
if (isInvokedDirectly()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
