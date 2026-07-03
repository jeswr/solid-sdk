// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:GeneticSummary` — the interpreted HLA summary (DESIGN §2.2 entity 8, §7,
 * RESEARCH §2.5). **PRIVACY-CRITICAL.**
 *
 * **Hard invariant, by construction:** this model can hold ONLY the interpreted
 * summary — a few `rsID → genotype → interpretation` rows plus the framing text.
 * There is NO field, accessor, or predicate for a raw genotype file: the raw
 * 23andMe/AncestryDNA export is parsed on-device (`FileReader`) by the app
 * (Brief 3B) and immediately discarded; only the summary reaches the pod. The
 * absence of any raw-bytes surface here is the data-layer half of "the raw file
 * never enters the pod" (`src/genetics.test.ts` asserts the API exposes no such
 * field).
 *
 * **Framing is negative-predictive only** (RESEARCH §2.5): carrying DQ2/DQ8 does
 * NOT mean coeliac (30–40% of everyone carries it); NOT carrying it makes coeliac
 * very unlikely; this cannot diagnose. Plus a chip-coverage caveat. The framing
 * lives in `diet:geneticInterpretation`; the app is responsible for presenting it.
 *
 * Typed accessors; never hand-built triples.
 */

import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import {
  DIET_GENETIC_SUMMARY,
  DIET_HLA_MARKER,
  dct,
  diet,
  HEALTH_PATIENT_PROP,
  rdf,
} from "./vocab.js";

/**
 * One interpreted HLA marker row (a `diet:HlaMarker`) — summary only, never raw
 * genotype data beyond the single relevant call. `diet:rsid` / `diet:genotype` /
 * `diet:markerInterpretation` are the canonical 1B terms.
 */
export interface HlaMarkerData {
  /** `diet:rsid` — the SNP id, e.g. `rs2187668` (DQ2.5 tag) / `rs7454108` (DQ8 tag). */
  rsid: string;
  /** `diet:genotype` — the called genotype at that SNP, e.g. `AG`. */
  genotype?: string;
  /** `diet:markerInterpretation` — e.g. "rs2187668 present → DQ2.5 risk haplotype". */
  markerInterpretation?: string;
}

/** The interpreted HLA summary (DESIGN §2.2 entity 8). Summary ONLY — never raw bytes. */
export interface GeneticSummaryData {
  /** Subject IRI (`${url}#it`); informational. */
  id?: string;
  /** `diet:hlaMarker` → the interpreted marker rows. */
  markers: HlaMarkerData[];
  /**
   * `diet:geneticInterpretation` — the negative-predictive framing + chip caveat.
   * REQUIRED (a SHACL MUST): a genetic summary must never be stored without its
   * "cannot diagnose you" framing, or the pod would hold a bare genotype call with
   * no interpretive guardrail. The builder rejects a missing/empty value; parsing
   * rejects a summary that lacks it.
   */
  interpretation: string;
  /** `diet:enteredManually` — manual-entry path vs parsed-upload path. */
  enteredManually?: boolean;
  /** `health:patient` — the pod-owner Patient/Person WebID. */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
}

/** The GeneticSummary subject IRI: `${url}#it`. */
export function geneticSummarySubject(url: string): string {
  return `${url}#it`;
}

// The SHACL `sh:maxCount 1` predicates (only these are guarded). Note
// diet:geneticInterpretation is min-count-1 but NOT max-count-1 in the shape, and
// diet:genotype is unconstrained — so neither is guarded here.
const GENETIC_SUMMARY_SINGLETONS: readonly string[] = [diet("enteredManually")];
const HLA_MARKER_SINGLETONS: readonly string[] = [diet("rsid"), diet("markerInterpretation")];
/** The n-th HLA marker node IRI: `${url}#marker-{n}`. */
export function markerSubject(url: string, index: number): string {
  return `${url}#marker-${index}`;
}
function trailingIndex(iri: string): number {
  const m = iri.match(/-(\d+)$/);
  return m ? Number.parseInt(m[1] as string, 10) : -1;
}

/** Typed `@rdfjs/wrapper` view of a `diet:GeneticSummary`. */
export class GeneticSummary extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_GENETIC_SUMMARY);
    return this;
  }
  get isGeneticSummary(): boolean {
    return this.types.has(DIET_GENETIC_SUMMARY);
  }

  /** `diet:hlaMarker` → the marker node IRIs (live set). */
  get hlaMarker(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("hlaMarker"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  get interpretation(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("geneticInterpretation"), LiteralAs.string);
  }
  set interpretation(value: string | undefined) {
    OptionalAs.object(this, diet("geneticInterpretation"), value, LiteralFrom.string);
  }

  get enteredManually(): boolean | undefined {
    return OptionalFrom.subjectPredicate(this, diet("enteredManually"), LiteralAs.boolean);
  }
  set enteredManually(value: boolean | undefined) {
    OptionalAs.object(this, diet("enteredManually"), value, LiteralFrom.boolean);
  }

  /** `health:patient` — the pod-owner Patient/Person WebID. */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
}

/** A single `diet:HlaMarker` node accessor (`diet:rsid`/`diet:genotype`/`diet:markerInterpretation`). */
class HlaMarker extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_HLA_MARKER);
    return this;
  }
  get rsid(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("rsid"), LiteralAs.string);
  }
  set rsid(value: string | undefined) {
    OptionalAs.object(this, diet("rsid"), value, LiteralFrom.string);
  }
  get genotype(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("genotype"), LiteralAs.string);
  }
  set genotype(value: string | undefined) {
    OptionalAs.object(this, diet("genotype"), value, LiteralFrom.string);
  }
  get markerInterpretation(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("markerInterpretation"), LiteralAs.string);
  }
  set markerInterpretation(value: string | undefined) {
    OptionalAs.object(this, diet("markerInterpretation"), value, LiteralFrom.string);
  }
}

/** Parse a GeneticSummary out of a dataset, or `undefined` if `${url}#it` is not one. */
export function parseGeneticSummary(
  url: string,
  dataset: DatasetCore,
): GeneticSummaryData | undefined {
  return tryRead(() => parseGeneticSummaryImpl(url, dataset));
}
function parseGeneticSummaryImpl(
  url: string,
  dataset: DatasetCore,
): GeneticSummaryData | undefined {
  const doc = new GeneticSummary(geneticSummarySubject(url), dataset, DataFactory);
  if (!doc.isGeneticSummary) return undefined;
  assertSubjectSingletons(dataset, geneticSummarySubject(url), GENETIC_SUMMARY_SINGLETONS);
  // The negative-predictive interpretation is a SHACL MUST — a summary without it
  // is not a usable (or safe) record; reject rather than surface a framing-less one.
  const interpretation = doc.interpretation;
  if (!interpretation || interpretation.trim() === "") return undefined;
  const data: GeneticSummaryData = { id: geneticSummarySubject(url), markers: [], interpretation };
  setIfDefined(data, "enteredManually", doc.enteredManually);
  // http(s)-filtered on READ (symmetric with the writer) — never surface a
  // non-http(s) IRI from a hostile pod document.
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));
  const nodes = [...doc.hlaMarker].sort((a, b) => trailingIndex(a) - trailingIndex(b));
  for (const node of nodes) {
    assertSubjectSingletons(dataset, node, HLA_MARKER_SINGLETONS);
    const m = new HlaMarker(node, dataset, DataFactory);
    const rsid = m.rsid;
    // Mirror the builder's rsid MUST on READ: drop a marker with a missing or
    // whitespace-only diet:rsid (an invalid HLA row must not surface from pod data).
    if (!rsid || rsid.trim() === "") continue;
    const marker: HlaMarkerData = { rsid };
    setIfDefined(marker, "genotype", m.genotype);
    setIfDefined(marker, "markerInterpretation", m.markerInterpretation);
    data.markers.push(marker);
  }
  return data;
}

/** Build a fresh n3 `Store` holding one GeneticSummary rooted at `${url}#it`. */
export function buildGeneticSummary(url: string, data: GeneticSummaryData): Store {
  if (!data.interpretation || data.interpretation.trim() === "") {
    throw new Error(
      "buildGeneticSummary: a diet:geneticInterpretation (the negative-predictive " +
        "framing) is REQUIRED and must be non-empty — refusing to write a genetics " +
        'summary with no "cannot diagnose you" guardrail.',
    );
  }
  const store = new Store();
  const doc = new GeneticSummary(geneticSummarySubject(url), store, DataFactory).mark();
  doc.interpretation = data.interpretation;
  doc.enteredManually = data.enteredManually;
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();
  data.markers.forEach((marker, i) => {
    // Fail-closed on the HlaMarker SHACL MUST: a non-empty diet:rsid. A marker with
    // no rsid writes an invalid node that parseGeneticSummary then drops silently.
    if (!marker.rsid || marker.rsid.trim() === "") {
      throw new Error(
        `buildGeneticSummary: HLA marker #${i} MUST have a non-empty diet:rsid — refusing to write an rsid-less marker.`,
      );
    }
    const node = markerSubject(url, i);
    const m = new HlaMarker(node, store, DataFactory).mark();
    m.rsid = marker.rsid;
    m.genotype = marker.genotype;
    m.markerInterpretation = marker.markerInterpretation;
    doc.hlaMarker.add(node);
  });
  return store;
}

/** Serialise a GeneticSummary to Turtle (via `n3.Writer`). */
export function serializeGeneticSummary(url: string, data: GeneticSummaryData): Promise<string> {
  return storeToTurtle(buildGeneticSummary(url, data));
}

/** Parse a fetched GeneticSummary body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseGeneticSummaryTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<GeneticSummaryData | undefined> {
  return parseGeneticSummary(url, await parseBody(body, url, contentType));
}
