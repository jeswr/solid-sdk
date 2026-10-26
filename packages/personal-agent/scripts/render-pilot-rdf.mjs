#!/usr/bin/env node
// Render the RDF evidence example from REAL runtime ledgers of synthetic runs (requires
// `npm run build`): reports/pilot-rdf-evidence.ttl, .jsonld and pilot-rdf-competency.json.
//
// Every competency query and assertion-absence check is EXECUTED by a real SPARQL 1.1 engine:
// a locally built SPARQ CLI (`sparq-cli query <file> turtle <sparql> --format json`), given by
// --sparq-cli=PATH or AWP_SPARQ_CLI and always invoked by explicit path. The package's small
// basic-graph-pattern helper is run as well, ONLY as an independent consistency comparison.
// Without the engine the graph files are still written, the report says setup-required and
// the script exits 3 (helper rows are never presented as engine results).
//
// Usage: node scripts/render-pilot-rdf.mjs --sparq-cli=PATH
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "n3";
import { DPV_VALIDATION } from "../dist/pilot/profile/vocabulary.js";
import {
  COMPETENCY_QUERIES,
  collectRuntimeEvidence,
  evidenceGraph,
  FORBIDDEN,
} from "../dist/pilot/rdf/competency.js";
import { ledgerToRdf, PREFIXES } from "../dist/pilot/rdf/evidence.js";
import { runQuery, toJsonLd, toSparql, toTurtle } from "../dist/pilot/rdf/serialise.js";

const root = new URL("..", import.meta.url);
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cliArg = flag("sparq-cli") ?? process.env.AWP_SPARQ_CLI;
const SPARQ_CLI = cliArg ? resolve(cliArg) : undefined;
const engineReady = SPARQ_CLI !== undefined && existsSync(SPARQ_CLI);

const ev = await collectRuntimeEvidence();
const { quads, reports } = evidenceGraph(ev);
const store = new Store(quads);
const header = [
  "# Example evidence graph generated from synthetic runtime ledgers (pilot 0.1).",
  "# All awp: terms are PROVISIONAL (unregistered namespace); see docs/rdf/awp-pilot.ttl.",
  "# Both agents run the same code base: this is NOT interoperability evidence.",
  "",
].join("\n");
const evidencePath = new URL("reports/pilot-rdf-evidence.ttl", root);
writeFileSync(evidencePath, header + (await toTurtle(quads)));
writeFileSync(
  new URL("reports/pilot-rdf-evidence.jsonld", root),
  `${JSON.stringify(toJsonLd(quads), null, 1)}\n`,
);

/** Compact an IRI exactly as the helper does (longest matching namespace). */
function compact(iri) {
  let best;
  for (const [p, ns] of Object.entries(PREFIXES))
    if (iri.startsWith(ns) && iri.length > ns.length && (!best || ns.length > best[1].length))
      best = [p, ns];
  return best ? `${best[0]}:${iri.slice(best[1].length)}` : iri;
}

/** Run one SELECT through the engine; returns the SPARQL 1.1 JSON results document. */
function engineSelect(ttlPath, sparql) {
  const r = spawnSync(SPARQ_CLI, ["query", ttlPath, "turtle", sparql, "--format", "json"], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {},
    shell: false,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `sparq-cli failed (${r.status}): ${(r.error?.message ?? r.stderr).slice(0, 500)}`,
    );
  return JSON.parse(r.stdout);
}

/** Engine rows with full RDF terms (type, value, datatype, language), deterministically sorted. */
function engineRows(doc) {
  const rows = doc.results.bindings.map((b) =>
    Object.fromEntries(
      Object.entries(b).map(([k, t]) => [
        k,
        {
          type: t.type,
          value: t.value,
          ...(t.datatype ? { datatype: t.datatype } : {}),
          ...(t["xml:lang"] ? { lang: t["xml:lang"] } : {}),
        },
      ]),
    ),
  );
  return rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

/** The helper's projection of engine rows (compacted IRIs, lexical literal values). */
function projection(rows) {
  const out = new Set(
    rows.map((r) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(r)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, t]) => [k, t.type === "uri" ? compact(t.value) : t.value]),
        ),
      ),
    ),
  );
  return [...out].sort();
}
const helperProjection = (rows) =>
  rows
    .map((r) =>
      JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)))),
    )
    .sort();

/**
 * Positive control for an absence check: a minimal graph that ASSERTS exactly the check's
 * pattern (each variable replaced by a fresh IRI; NOT EXISTS groups left unasserted), so the
 * engine must return at least one row — showing a zero on the real export is not vacuous.
 */
function controlTurtle(query) {
  const term = (t) => {
    if (t.startsWith("?")) return `<urn:awp:control:${t.slice(1)}>`;
    if (t === "a") return "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
    const i = t.indexOf(":");
    const ns = i > 0 ? PREFIXES[t.slice(0, i)] : undefined;
    return ns ? `<${ns}${t.slice(i + 1)}>` : `<${t}>`;
  };
  return `${query.where.map((p) => `${p.map(term).join(" ")} .`).join("\n")}\n`;
}

const work = mkdtempSync(join(tmpdir(), "awp-rdf-"));
const ledgerFiles = {};
for (const [id, entries] of Object.entries(ev.ledgers)) {
  const p = join(work, `${id.replace(/[^A-Za-z0-9]+/g, "-")}.ttl`);
  writeFileSync(p, await toTurtle(ledgerToRdf(entries, id).quads));
  ledgerFiles[id] = p;
}
const beforePath = join(work, "bob-before-reconcile.ttl");
writeFileSync(
  beforePath,
  await toTurtle(ledgerToRdf(ev.beforeReconcile, "urn:awp:ledger:bob").quads),
);
const beforeStore = new Store(ledgerToRdf(ev.beforeReconcile, "urn:awp:ledger:bob").quads);
const unresolved = COMPETENCY_QUERIES.find((q) => q.id === "CQ-R11-unresolved");

let engine;
let queries;
let unresolvedBeforeReconcile;
let absence;
let controls;
const disagreements = [];
try {
  if (engineReady) {
    engine = {
      status: "executed",
      implementation: `SPARQ ${basename(SPARQ_CLI)} (SPARQL 1.1 engine, local build from the isolated sparq-policy worktree)`,
      invocation: "sparq-cli query <file> turtle <sparql> --format json (no reasoning flag)",
      binarySha256: createHash("sha256").update(readFileSync(SPARQ_CLI)).digest("hex"),
    };
    const compare = (id, graph, rows, helperRows) => {
      const same =
        JSON.stringify(projection(rows)) === JSON.stringify(helperProjection(helperRows));
      if (!same) disagreements.push({ id, graph });
      return { helperRows: helperRows.length, sameProjection: same };
    };
    queries = COMPETENCY_QUERIES.map((q) => {
      const sparql = toSparql(q);
      const rows = engineRows(engineSelect(fileURLToPath(evidencePath), sparql));
      return {
        id: q.id,
        question: q.question,
        sparql,
        rows,
        consistencyWithHelper: compare(q.id, "evidence", rows, runQuery(store, q)),
      };
    });
    const uRows = engineRows(engineSelect(beforePath, toSparql(unresolved)));
    compare("CQ-R11-unresolved", "bob-before-reconcile", uRows, runQuery(beforeStore, unresolved));
    unresolvedBeforeReconcile = uRows;
    absence = Object.fromEntries(
      Object.entries(ledgerFiles).map(([id, path]) => {
        const one = new Store(ledgerToRdf(ev.ledgers[id], id).quads);
        return [
          id,
          Object.fromEntries(
            FORBIDDEN.map((f) => {
              const rows = engineRows(engineSelect(path, toSparql(f)));
              compare(f.id, id, rows, runQuery(one, f));
              return [f.id, rows.length];
            }),
          ),
        ];
      }),
    );
    controls = Object.fromEntries(
      FORBIDDEN.map((f) => {
        const p = join(work, `control-${f.id}.ttl`);
        writeFileSync(p, controlTurtle(f));
        return [f.id, engineRows(engineSelect(p, toSparql(f))).length];
      }),
    );
  } else {
    engine = {
      status: "setup-required",
      detail:
        "no SPARQL engine given: build sparq-cli in the sparq-policy worktree (`cargo build -p sparq-cli`) and pass --sparq-cli=PATH or AWP_SPARQ_CLI; no query results are reported without it",
    };
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const out = {
  report: "Agentic Web pilot — RDF evidence competency queries",
  notice:
    "Each SPARQL query below was executed by the SPARQL engine named in `engine` over the exported Turtle, without reasoning. `consistencyWithHelper` compares the engine's rows with the pilot's small basic-graph-pattern helper (an independent implementation) on the helper's projection (compacted IRIs, lexical literal values); agreement is consistency evidence, not formal conformance. Assertion-absence checks run per ledger: an empty answer shows the export does not ASSERT the pattern; it does not prove the pattern is not entailed under PROV/ODRL/RDFS semantics.",
  engine,
  triples: store.size,
  dpv: DPV_VALIDATION,
  conversion: reports,
  ...(queries ? { queries } : {}),
  ...(unresolvedBeforeReconcile ? { unresolvedBeforeReconcile } : {}),
  absenceChecks: FORBIDDEN.map((q) => ({ id: q.id, question: q.question, sparql: toSparql(q) })),
  ...(absence ? { absenceCheckAnswerCountsPerLedger: absence } : {}),
  ...(controls
    ? {
        absenceCheckPositiveControls: {
          note: "rows the engine returns for each check over a minimal graph asserting exactly its pattern (must be ≥ 1)",
          rows: controls,
        },
      }
    : {}),
  ...(engineReady ? { disagreementsWithHelper: disagreements } : {}),
};
writeFileSync(
  new URL("reports/pilot-rdf-competency.json", root),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    triples: store.size,
    engine: engine.status,
    queries: queries?.map((q) => [q.id, q.rows.length, q.consistencyWithHelper.sameProjection]),
    unresolvedBeforeReconcile: unresolvedBeforeReconcile?.length,
    disagreements: engineReady ? disagreements.length : undefined,
    positiveControls: controls,
  }),
);
const controlsOk = controls && Object.values(controls).every((n) => n >= 1);
process.exit(!engineReady ? 3 : disagreements.length === 0 && controlsOk ? 0 : 1);
