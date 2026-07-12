// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// One-shot importer: bring the gUFO-based Solid Core + the 6 sector ontologies
// (identity, finance, health, media, scheduling, contacts) from the
// full-solid-ecosystem federation working tree INTO this repo, RE-NAMESPACED from
// the placeholder `https://TBD.example/solid/<x>` IRIs to the persistent
// `https://w3id.org/jeswr/` home decided in prod-solid-server ADR-0013:
//
//   https://TBD.example/solid/core      -> https://w3id.org/jeswr/core
//   https://TBD.example/solid/<sector>  -> https://w3id.org/jeswr/sectors/<sector>
//
// This is a TEXT transform over Turtle source (the .ttl files are authored as
// Turtle directly — the suite house rule); every output is then re-parsed with
// n3 by validate.mjs / ontology-gate.mjs to prove well-formedness, and the merged
// closure is reasoned by ROBOT/HermiT (when available) for 0 unsatisfiable
// classes. RDF that this repo GENERATES (dist/vocab.nt, the example) still goes
// through n3.Writer / @rdfjs/wrapper — never string-concat.
//
// Re-run only when re-syncing from the upstream federation tree. The committed
// sectors/ files are the source of truth in THIS repo; the upstream tree is the
// origin of the modelling. Run: `node scripts/import-sectors.mjs <fse-onto-dir>`.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Default upstream location; override with argv[2].
const SRC =
  process.argv[2] ||
  join(ROOT, "..", "full-solid-ecosystem", "federation", "ontologies");

if (!existsSync(SRC)) {
  console.error(`source ontology dir not found: ${SRC}`);
  console.error("pass the federation/ontologies path as the first argument");
  process.exit(1);
}

const OLD_BASE = "https://TBD.example/solid";
const NEW_CORE = "https://w3id.org/jeswr/core";
const NEW_SECTORS = "https://w3id.org/jeswr/sectors";

const MARKER = "# AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate\n";

/** Global IRI re-namespacing. Order matters: core before the generic sector rule. */
function rebase(text) {
  let out = text;
  // core (+ its /1.0.0 version IRIs, /shapes, /alignments suffixes ride along)
  out = out.split(`${OLD_BASE}/core`).join(NEW_CORE);
  // sectors: every remaining https://TBD.example/solid/<x> becomes a sectors/<x>
  out = out.split(`${OLD_BASE}/`).join(`${NEW_SECTORS}/`);
  // any bare OLD_BASE with no trailing slash (defensive)
  out = out.split(OLD_BASE).join(NEW_SECTORS);
  return out;
}

/** Replace the placeholder-era prose so no doc says the namespace is "TBD". */
function dePlaceholder(text) {
  let t = text
    // the core.ttl multi-line placeholder block: "NAMESPACE IS A PLACEHOLDER
    // pending namespace decision #2. Final home likely\n# https://w3id.org/solid/
    // core#. The consistency engine resolves placeholder + …" — collapse the whole
    // sentence pair, keeping the trailing "gUFO owl:imports …" clause.
    .replace(
      /NAMESPACE IS A PLACEHOLDER pending namespace decision #2\. Final home likely\s*\n#\s*https:\/\/w3id\.org\/solid\/core#\. The consistency engine resolves placeholder \+\s*\n#\s*/g,
      "The consistency engine resolves ",
    )
    // in-comment placeholder sentences (with the surrounding "Final home likely…")
    .replace(/NAMESPACE IS A PLACEHOLDER pending namespace decision #2\.[^\n]*/g, "")
    .replace(/Final home likely[^\n]*/g, "")
    .replace(/NAMESPACE IS A PLACEHOLDER\.?/g, "")
    // metadata-string placeholder phrasings
    .replace(/Placeholder namespaces? pending decision #2\.\s*/g, "")
    .replace(/Placeholder pending decision #2\.\s*/g, "")
    .replace(/Placeholder Core IRIs \(decision #2\)[^.\n]*\.?/g, "")
    .replace(/Placeholder IRIs \(decision #2\)[^.\n]*\.?/g, "")
    .replace(/\(decision #2 pending\)/g, "");
  // Drop comment lines left empty or doubly-hashed ("# #", "# # ===…") after the
  // placeholder sentence was excised, and collapse the blank line they leave.
  t = t
    .split("\n")
    .filter((ln) => {
      const s = ln.trim();
      if (s === "# #") return false; // emptied comment line
      // orphaned "# https://w3id.org/solid/<x>#." left when its "Final home
      // likely" lead-in was excised on the previous line.
      if (/^#\s*https:\/\/w3id\.org\/solid\/[a-z]+#\.?\s*$/.test(s)) return false;
      return true;
    })
    .map((ln) => {
      // "# # =====" (a section rule that lost its placeholder body) -> "# ====="
      if (/^#\s+#\s+=+\s*$/.test(ln)) return "# " + ln.replace(/^#\s+#\s+/, "");
      // "# # text" (a real comment that had a placeholder sentence before it) -> "# text"
      if (/^#\s+#\s+\S/.test(ln)) return ln.replace(/^(#\s+)#\s+/, "$1");
      return ln;
    })
    .join("\n");
  // collapse a run of 2+ blank-comment lines ("#\n#\n#") to a single "#"
  t = t.replace(/(^#\s*$\n)(^#\s*$\n)+/gm, "#\n");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** Ensure the AUTHORED-BY provenance marker is present (lint requires it on .ttl). */
function ensureMarker(text) {
  if (text.includes("AUTHORED-BY Claude Opus 4.8")) return text;
  return MARKER + "#\n" + text;
}

// Pretty sector names for the marker labels.
const SECTOR_LABEL = {
  identity: "Identity & Profile",
  finance: "Finance",
  health: "Health",
  media: "Media & Activity",
  scheduling: "Scheduling",
  contacts: "Contacts",
};

/**
 * Append the `<ns>sector` marker term that `fedapp:sector` dereferences to
 * (`https://w3id.org/jeswr/sectors/<x>#sector`). It is a skos:Concept whose
 * scheme is the federation sector register; an app's Client-ID document names it
 * as the sector it operates in. Declared here so the IRI resolves and carries a
 * definition (validate.mjs requires rdfs:label/comment on each named term). Kept
 * vocabulary-neutral (skos:Concept, no fedapp import) so the sector ontology has
 * no dependency on the fedapp vocabulary.
 */
function addSectorMarker(text, sector) {
  if (text.includes(`<https://w3id.org/jeswr/sectors/${sector}#sector>`)) return text;
  const label = SECTOR_LABEL[sector] ?? sector;
  const block = `
# =============================================================================
# SECTOR MARKER — the IRI an app's fedapp:sector points at to declare it operates
# in this sector (https://w3id.org/jeswr/fed#sector). A skos:Concept in the
# federation sector register; dereferences to this ontology.
# =============================================================================

<https://w3id.org/jeswr/sectors/${sector}#sector>
    a <http://www.w3.org/2004/02/skos/core#Concept> ;
    rdfs:label "${label} sector"@en ;
    rdfs:comment "The ${label} data sector. The value an app's fedapp:sector names in its Client Identifier Document to declare it operates over ${label.toLowerCase()} data. Backed by this sector ontology."@en ;
    rdfs:isDefinedBy <https://w3id.org/jeswr/sectors/${sector}> ;
    skos:prefLabel "${label}"@en .
`;
  // ensure a trailing newline then append
  return text.replace(/\s*$/, "\n") + block;
}

function transform(srcFile, destFile, { verbatim = false, sectorMarker = null } = {}) {
  let t = readFileSync(srcFile, "utf8");
  if (!verbatim) {
    // Authored-by-us sources: re-namespace + de-placeholder + provenance marker.
    t = rebase(t);
    t = dePlaceholder(t);
    t = ensureMarker(t);
    if (sectorMarker) t = addSectorMarker(t, sectorMarker);
  }
  // Vendored third-party imports (gufo/owl-time/prov/skos/qudt) are copied
  // VERBATIM — they keep their own IRIs and carry no AUTHORED-BY marker (not ours).
  mkdirSync(dirname(destFile), { recursive: true });
  writeFileSync(destFile, t);
  console.log(`  ${destFile.replace(ROOT + "/", "")}${verbatim ? "  (vendored verbatim)" : ""}`);
}

/** Foundation-import dest paths copied verbatim (no transform). */
const VERBATIM = new Set([
  "sectors/core/imports/gufo.ttl",
  "sectors/core/imports/owl-time.ttl",
  "sectors/core/imports/prov-o.ttl",
  "sectors/core/imports/skos.ttl",
  "sectors/core/imports/qudt-schema.ttl",
  "sectors/core/imports/qudt-units-slim.ttl",
]);

// ---- the file manifest: [src-relative, dest-relative] -----------------------
const FILES = [
  // core
  ["core/solid-core.ttl", "sectors/core/core.ttl"],
  ["core/solid-core.shacl.ttl", "sectors/core/core.shacl.ttl"],
  ["core/solid-core-alignments.ttl", "sectors/core/core-alignments.ttl"],
  // identity
  ["sectors/identity/identity.ttl", "sectors/identity/identity.ttl"],
  ["sectors/identity/identity.shacl.ttl", "sectors/identity/identity.shacl.ttl"],
  ["sectors/identity/identity-alignments.ttl", "sectors/identity/identity-alignments.ttl"],
  // finance
  ["sectors/finance/finance.ttl", "sectors/finance/finance.ttl"],
  ["sectors/finance/finance.shacl.ttl", "sectors/finance/finance.shacl.ttl"],
  ["sectors/finance/finance-alignments.ttl", "sectors/finance/finance-alignments.ttl"],
  ["sectors/finance/imports/fibo-slim.ttl", "sectors/finance/imports/fibo-slim.ttl"],
  // health
  ["sectors/health/health.ttl", "sectors/health/health.ttl"],
  ["sectors/health/health.shacl.ttl", "sectors/health/health.shacl.ttl"],
  ["sectors/health/health-alignments.ttl", "sectors/health/health-alignments.ttl"],
  ["sectors/health/imports/qudt-health-slim.ttl", "sectors/health/imports/qudt-health-slim.ttl"],
  // media
  ["sectors/media/media.ttl", "sectors/media/media.ttl"],
  ["sectors/media/media.shacl.ttl", "sectors/media/media.shacl.ttl"],
  ["sectors/media/media-alignments.ttl", "sectors/media/media-alignments.ttl"],
  // scheduling
  ["sectors/scheduling/scheduling.ttl", "sectors/scheduling/scheduling.ttl"],
  ["sectors/scheduling/scheduling.shacl.ttl", "sectors/scheduling/scheduling.shacl.ttl"],
  ["sectors/scheduling/scheduling-alignments.ttl", "sectors/scheduling/scheduling-alignments.ttl"],
  // contacts
  ["sectors/contacts/contacts.ttl", "sectors/contacts/contacts.ttl"],
  ["sectors/contacts/contacts.shacl.ttl", "sectors/contacts/contacts.shacl.ttl"],
  ["sectors/contacts/contacts-alignments.ttl", "sectors/contacts/contacts-alignments.ttl"],
  // foundation imports (vendored, for the offline ROBOT/HermiT closure)
  ["core/imports/gufo.ttl", "sectors/core/imports/gufo.ttl"],
  ["core/imports/owl-time.ttl", "sectors/core/imports/owl-time.ttl"],
  ["core/imports/prov-o.ttl", "sectors/core/imports/prov-o.ttl"],
  ["core/imports/skos.ttl", "sectors/core/imports/skos.ttl"],
  ["core/imports/qudt-schema.ttl", "sectors/core/imports/qudt-schema.ttl"],
  ["core/imports/qudt-units-slim.ttl", "sectors/core/imports/qudt-units-slim.ttl"],
];

console.log("Importing + re-namespacing ontologies from:", SRC, "\n");
for (const [src, dest] of FILES) {
  const sp = join(SRC, src);
  if (!existsSync(sp)) {
    console.error(`  MISSING source: ${src}`);
    process.exitCode = 1;
    continue;
  }
  // the main sector ontology file (sectors/<x>/<x>.ttl, x != core) gets the
  // fedapp:sector marker term appended.
  const m = dest.match(/^sectors\/([a-z]+)\/\1\.ttl$/);
  const sectorMarker = m && m[1] !== "core" ? m[1] : null;
  transform(sp, join(ROOT, dest), { verbatim: VERBATIM.has(dest), sectorMarker });
}
console.log("\nImported. Foundation imports (gufo/owl-time/prov/skos/qudt) are vendored");
console.log("verbatim (no re-namespacing — they keep their own IRIs).");
