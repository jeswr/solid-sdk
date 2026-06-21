// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Consistency gate for the gUFO-based Solid Core + sector ontologies under
// sectors/. Three layers, cheap -> deep:
//
//   1. WELL-FORMEDNESS — parse every sectors/**/*.ttl with n3.Parser (count
//      quads, fail on a parse error). RDF goes through n3 only (suite house rule).
//   2. TERM HYGIENE — every NAMED term in an ontology's own namespace carries
//      rdfs:label AND a definition (rdfs:comment OR skos:definition). gUFO models
//      use skos:definition; this gate accepts either, unlike the thin-vocab
//      validate.mjs which requires rdfs:comment on the small fed/task vocabs.
//   3. REASONER CONSISTENCY (F6) — for the Core + each sector, run
//      `robot reason --reasoner HermiT` over the owl:imports closure (resolved
//      offline via the per-dir OASIS catalog-v001.xml) and assert ZERO
//      unsatisfiable classes and a consistent ontology.
//
// FAIL-SOFT on the tool, NEVER on a real defect: the reasoner step shells out to
// ROBOT/HermiT only when Java + a robot.jar are discoverable (env SOLIDFED_ROBOT_JAR
// or ROBOT_JAR, else `robot` on PATH). When absent (e.g. a CI box without Java) it
// prints a SKIP notice naming the missing tool — it never silently passes a wrong
// model, but it does not block the npm gate on a host-capability gap. Set
// PSS_ONTOLOGY_REASON=required to turn an unavailable reasoner into a failure
// (the local authoritative path uses the real HermiT pass).
//
// Layers 1 + 2 are pure n3 + always run.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { Parser } from "n3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECTORS = join(ROOT, "sectors");

const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL = "http://www.w3.org/2002/07/owl#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";

let failures = 0;
const fail = (m) => {
  console.error(`  ✗ ${m}`);
  failures += 1;
};
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => console.log(`  · ${m}`);

// --- the ontologies + their own namespaces (term-hygiene scope) ---------------
// Each entry: { dir, file, ns } — `ns` is the namespace whose NAMED terms must
// carry label + definition. SHACL/alignments/imports files are parsed for
// well-formedness but their shapes/bridges aren't held to the F1 term rule.
const ONTOLOGIES = [
  { dir: "core", file: "core.ttl", ns: "https://w3id.org/jeswr/core#" },
  { dir: "identity", file: "identity.ttl", ns: "https://w3id.org/jeswr/sectors/identity#" },
  { dir: "finance", file: "finance.ttl", ns: "https://w3id.org/jeswr/sectors/finance#" },
  { dir: "health", file: "health.ttl", ns: "https://w3id.org/jeswr/sectors/health#" },
  { dir: "media", file: "media.ttl", ns: "https://w3id.org/jeswr/sectors/media#" },
  { dir: "scheduling", file: "scheduling.ttl", ns: "https://w3id.org/jeswr/sectors/scheduling#" },
  { dir: "contacts", file: "contacts.ttl", ns: "https://w3id.org/jeswr/sectors/contacts#" },
  { dir: "drawing", file: "drawing.ttl", ns: "https://w3id.org/jeswr/sectors/drawing#" },
  { dir: "social", file: "social.ttl", ns: "https://w3id.org/jeswr/sectors/social#" },
  { dir: "bookmarks", file: "bookmarks.ttl", ns: "https://w3id.org/jeswr/sectors/bookmarks#" },
];

// =============================================================================
// Layer 1 — well-formedness (parse every .ttl under sectors/)
// =============================================================================
function listTtl(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTtl(p));
    else if (e.name.endsWith(".ttl")) out.push(p);
  }
  return out;
}

console.log("Layer 1 — Turtle well-formedness (n3.Parser):");
const ttlFiles = existsSync(SECTORS) ? listTtl(SECTORS) : [];
if (ttlFiles.length === 0) fail("no .ttl files under sectors/");
const parsedQuads = new Map(); // path -> quads
let totalQuads = 0;
for (const p of ttlFiles.sort()) {
  const rel = relative(ROOT, p);
  try {
    const quads = new Parser({ baseIRI: `https://w3id.org/jeswr/${rel}` }).parse(
      readFileSync(p, "utf8"),
    );
    parsedQuads.set(p, quads);
    totalQuads += quads.length;
  } catch (err) {
    fail(`${rel}: parse error: ${err.message}`);
  }
}
if (failures === 0) ok(`${ttlFiles.length} Turtle file(s) well-formed (${totalQuads} quads)`);

// =============================================================================
// Layer 2 — term hygiene (label + definition on every named term in its own ns)
// =============================================================================
console.log("\nLayer 2 — term hygiene (rdfs:label + a definition per named term):");
for (const { dir, file, ns } of ONTOLOGIES) {
  const p = join(SECTORS, dir, file);
  const quads = parsedQuads.get(p);
  if (!quads) {
    fail(`${dir}/${file}: not parsed (see layer 1)`);
    continue;
  }
  // collect predicates per subject in this ontology's own namespace
  const preds = new Map(); // subjIRI -> Set(pred)
  let hasOntologyNode = false;
  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    if (
      q.predicate.value === RDF_TYPE &&
      q.object.value === `${OWL}Ontology`
    ) {
      hasOntologyNode = true;
    }
    if (!q.subject.value.startsWith(ns)) continue;
    const s = preds.get(q.subject.value) ?? new Set();
    s.add(q.predicate.value);
    preds.set(q.subject.value, s);
  }
  if (!hasOntologyNode) fail(`${dir}/${file}: no owl:Ontology node`);
  let terms = 0;
  let bad = 0;
  for (const [iri, ps] of preds) {
    // skip the ontology node itself + the version/shape/alignments sibling IRIs
    if (iri === ns.replace(/#$/, "")) continue;
    terms += 1;
    // a label is rdfs:label OR (for SKOS coded-value individuals) skos:prefLabel
    const hasLabel = ps.has(`${RDFS}label`) || ps.has(`${SKOS}prefLabel`);
    const hasDef = ps.has(`${RDFS}comment`) || ps.has(`${SKOS}definition`);
    if (!hasLabel || !hasDef) {
      bad += 1;
      fail(
        `${dir}: ${iri} missing ${[
          !hasLabel ? "rdfs:label|skos:prefLabel" : null,
          !hasDef ? "rdfs:comment|skos:definition" : null,
        ]
          .filter(Boolean)
          .join(" + ")}`,
      );
    }
  }
  if (bad === 0) ok(`${dir}: ${terms} named term(s) carry label + definition`);
}

// =============================================================================
// Layer 3 — reasoner consistency (F6: robot reason --reasoner HermiT)
// =============================================================================
console.log("\nLayer 3 — reasoner consistency (ROBOT / HermiT, 0 unsatisfiable):");

function findRobotJar() {
  for (const env of ["SOLIDFED_ROBOT_JAR", "ROBOT_JAR"]) {
    const v = process.env[env];
    if (v && existsSync(v)) return { kind: "jar", path: v };
  }
  // a `robot` launcher on PATH
  try {
    execFileSync("robot", ["--version"], { stdio: "ignore" });
    return { kind: "robot", path: "robot" };
  } catch {
    /* not on PATH */
  }
  return null;
}

function hasJava() {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const robot = findRobotJar();
const required = process.env.PSS_ONTOLOGY_REASON === "required";

if (!robot || (robot.kind === "jar" && !hasJava())) {
  const msg =
    "ROBOT/HermiT not available (set SOLIDFED_ROBOT_JAR or ROBOT_JAR to a robot.jar, " +
    "or put `robot` on PATH) — reasoner consistency (F6) SKIPPED. " +
    "The Turtle well-formedness + term hygiene above still ran. The authoritative " +
    "HermiT pass runs in the maintainer's local gate.";
  if (required) fail(msg + " [PSS_ONTOLOGY_REASON=required]");
  else note("SKIP: " + msg);
} else {
  for (const { dir, file } of ONTOLOGIES) {
    const cwd = join(SECTORS, dir);
    const catalog = join(cwd, "catalog-v001.xml");
    if (!existsSync(catalog)) {
      fail(`${dir}: no catalog-v001.xml (needed for offline owl:imports resolution)`);
      continue;
    }
    const out = join(cwd, ".reasoned.tmp.ttl");
    const args =
      robot.kind === "jar"
        ? ["-jar", robot.path]
        : [];
    const robotArgs = [
      "reason",
      "--reasoner",
      "HermiT",
      "--catalog",
      "catalog-v001.xml",
      "--input",
      file,
      "--output",
      ".reasoned.tmp.ttl",
    ];
    let blob = "";
    let code = 0;
    try {
      if (robot.kind === "jar") {
        blob = execFileSync("java", [...args, ...robotArgs], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        blob = execFileSync("robot", robotArgs, {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (err) {
      code = err.status ?? 1;
      blob = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    } finally {
      try {
        if (existsSync(out)) statSync(out) && execFileSync("rm", ["-f", out]);
      } catch {
        /* best-effort cleanup */
      }
    }
    const low = blob.toLowerCase();
    const unsat = (blob.match(/unsatisfiable:/gi) || []).length;
    const inconsistent = low.includes("ontology is inconsistent");
    if (inconsistent) {
      fail(`${dir}: ontology is INCONSISTENT under HermiT (F6)`);
    } else if (unsat > 0 || (code !== 0 && low.includes("unsatisfiable"))) {
      fail(`${dir}: ${unsat || "≥1"} unsatisfiable class(es) under HermiT (F6)`);
    } else if (code !== 0) {
      const errLine = blob
        .split("\n")
        .find((l) => /exception|error|could not/i.test(l) && !/WARNING|Unsafe/i.test(l));
      fail(`${dir}: robot reason exited ${code}${errLine ? ` — ${errLine.trim()}` : ""}`);
    } else {
      ok(`${dir}: consistent, 0 unsatisfiable classes (HermiT)`);
    }
  }
}

// =============================================================================
console.log("");
if (failures > 0) {
  console.error(`ONTOLOGY GATE FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log("ONTOLOGY GATE PASSED.");
