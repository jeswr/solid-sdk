// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// verify(...) — fetch (or accept) an app's federation registration document and
// validate it against the fedapp vocabulary: exactly one fedapp:App, every
// declared access mode is a valid acl:Mode, every SectorUse has a sector and at
// least one access mode, and the registration is non-empty. Parsing is via
// @jeswr/fetch-rdf (Turtle/JSON-LD conneg); extraction via the typed wrappers.

import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import type { AppRegistration, SectorUse, VerificationIssue, VerificationResult } from "./types.js";
import {
  accessModeName,
  FEDAPP_ACCESS,
  FEDAPP_CONSUMES,
  FEDAPP_DECLARES_SHAPE,
  FEDAPP_PRODUCES,
  FEDAPP_SECTOR,
  VALID_ACCESS_MODE_IRIS,
} from "./vocab.js";
import {
  type AppNode,
  type FederationDataset,
  type SectorUseNode,
  type TermWrapperType,
  wrap,
} from "./wrappers.js";

/** Options for {@link verify}. */
export interface VerifyOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Skip the network entirely and verify an RDF body already in hand. When set,
   * the `input` to `verify` is treated as the document body (not a URL) and
   * `bodyContentType` selects the parser.
   */
  readonly body?: string;
  /** Content-Type for {@link VerifyOptions.body} (default `text/turtle`). */
  readonly bodyContentType?: string;
  /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
  readonly baseIRI?: string;
  /**
   * Require the single `fedapp:App` subject to equal the fetched URL (the
   * expected client-id IRI). This binds the description to the location it was
   * served from, so a document at URL A cannot cleanly describe a different app
   * IRI B (a spoofing vector for the federation trust model).
   *
   * Defaults to `true` for a FETCHED document (the URL is a meaningful identity
   * claim) and to `false` for a `body` already in hand (the caller supplies a
   * base IRI, not an authoritative location). Set explicitly to override either.
   */
  readonly requireSubjectMatch?: boolean;
}

/**
 * Verify an app's federation registration.
 *
 * @param input - the registration document URL (fetched + parsed) OR, when
 *   `options.body` is set, the base IRI for the supplied body.
 * @returns a {@link VerificationResult}: `valid` plus the parsed
 *   {@link AppRegistration} and any {@link VerificationIssue}s.
 */
export async function verify(
  input: string,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const isBody = options.body !== undefined;
  let dataset: DatasetCore;
  try {
    if (options.body !== undefined) {
      dataset = await parseRdf(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input,
      });
    } else {
      const fetched = await fetchRdf(input, options.fetch ? { fetch: options.fetch } : {});
      dataset = fetched.dataset;
    }
  } catch (err) {
    const code = err instanceof RdfFetchError && err.status ? "fetch-failed" : "parse-failed";
    return {
      valid: false,
      issues: [{ code, message: describeError(err), subject: input }],
    };
  }

  // A FETCHED document is bound to the URL it was served from by default — the
  // App subject must equal `input` (the expected client-id IRI), else a document
  // at URL A could describe a different app B. A `body` in hand carries no
  // authoritative location, so subject-binding is off by default there. Either
  // can be overridden via `options.requireSubjectMatch`.
  const requireSubjectMatch = options.requireSubjectMatch ?? !isBody;
  return verifyDataset(dataset, input, { requireSubjectMatch });
}

/** Options for {@link verifyDataset}. */
export interface VerifyDatasetOptions {
  /**
   * Require the single `fedapp:App` subject to equal `expectedId`. When `true`,
   * a document whose App subject ≠ `expectedId` is rejected with a
   * `subject-mismatch` issue (the spoofing guard). Requires `expectedId`; if
   * `expectedId` is absent this check is skipped. Defaults to `false` so the
   * existing registry / offline `{body}` callers (where the subject legitimately
   * differs from the fetch/base IRI) keep their behaviour.
   */
  readonly requireSubjectMatch?: boolean;
}

/**
 * Verify an already-parsed dataset. Exposed so callers who fetched the RDF
 * themselves (e.g. inside {@link list}) avoid a second fetch.
 *
 * @param dataset - the parsed RDF graph.
 * @param expectedId - the document URL / expected client-id IRI. Used to scope
 *   error messages and, when `options.requireSubjectMatch` is set, to bind the
 *   `fedapp:App` subject to this IRI.
 * @param options - see {@link VerifyDatasetOptions}.
 */
export function verifyDataset(
  dataset: DatasetCore,
  expectedId?: string,
  options: VerifyDatasetOptions = {},
): VerificationResult {
  const fed: FederationDataset = wrap(dataset);
  const apps = fed.apps();
  const issues: VerificationIssue[] = [];

  if (apps.length === 0) {
    issues.push({
      code: "no-app",
      message: "No fedapp:App subject found in the registration document.",
      subject: expectedId,
    });
    return { valid: false, issues };
  }
  if (apps.length > 1) {
    issues.push({
      code: "multiple-apps",
      message: `Expected exactly one fedapp:App; found ${apps.length}.`,
      subject: expectedId,
    });
  }

  // Subject-binding (spoofing guard): when the caller asserts an expected IRI
  // (the fetch URL for a fetched document), the App subject MUST equal it — a
  // document served at URL A must not describe a different app B. Off by default
  // (verifyDataset's registry/offline callers legitimately have subject ≠
  // location); `verify()` turns it on for fetched documents.
  const appNode = apps[0] as AppNode;
  if (options.requireSubjectMatch && expectedId !== undefined && appNode.value !== expectedId) {
    issues.push({
      code: "subject-mismatch",
      message: `fedapp:App subject (${appNode.value}) does not equal the expected client-id IRI (${expectedId}).`,
      subject: appNode.value,
      value: expectedId,
    });
  }

  // verify() treats a registration document as describing ONE app: it projects
  // and validates the first fedapp:App (a >1 count is already flagged above as a
  // `multiple-apps` issue). Use list() for multi-app registry documents, which
  // verifies each app independently via verifyApp().
  const result = verifyApp(appNode);
  issues.push(...result.issues);

  return {
    valid: issues.length === 0,
    registration: result.registration,
    issues,
  };
}

/**
 * Verify a single {@link AppNode} in isolation: project it to an
 * {@link AppRegistration} and run the per-app checks (well-formed access modes,
 * complete SectorUse blocks, non-empty, requests some access). Exposed so
 * {@link list} can verify each app of a multi-app registry document independently.
 */
export function verifyApp(app: AppNode): VerificationResult {
  const issues: VerificationIssue[] = [];
  const registration = appToRegistration(app, issues);

  if (isEmptyRegistration(registration)) {
    issues.push({
      code: "empty-registration",
      message:
        "fedapp:App declares no sectors, access modes, consumed/produced shapes, declared shapes or sector-use blocks.",
      subject: registration.id,
    });
  }

  // A meaningful registration should request at least one access mode, either
  // flat on the App or within a SectorUse.
  const hasAnyAccess =
    (registration.access?.length ?? 0) > 0 ||
    (registration.sectorUse ?? []).some((su) => su.access.length > 0);
  if (!hasAnyAccess && !isEmptyRegistration(registration)) {
    issues.push({
      code: "missing-access",
      message: "fedapp:App requests no access modes (no fedapp:access flat or in any SectorUse).",
      subject: registration.id,
    });
  }

  return { valid: issues.length === 0, registration, issues };
}

/** Project an {@link AppNode} into a plain {@link AppRegistration}, recording issues. */
function appToRegistration(app: AppNode, issues: VerificationIssue[]): AppRegistration {
  const access = mapAccessModes(app.access, app.value, FEDAPP_ACCESS, issues);
  const sectorUse = [...app.sectorUses].map((node) => sectorUseNodeToView(node, issues));

  return {
    id: app.value,
    sectors: validIris(app.sectors, app.value, FEDAPP_SECTOR, issues),
    access,
    consumes: validIris(app.consumes, app.value, FEDAPP_CONSUMES, issues),
    produces: validIris(app.produces, app.value, FEDAPP_PRODUCES, issues),
    declaresShape: validIris(app.declaresShape, app.value, FEDAPP_DECLARES_SHAPE, issues),
    sectorUse,
  };
}

/** Project a {@link SectorUseNode} into a {@link SectorUse} view, recording issues. */
function sectorUseNodeToView(node: SectorUseNode, issues: VerificationIssue[]): SectorUse {
  const id = node.value;
  const sectors = validIris(node.sectors, id, FEDAPP_SECTOR, issues);
  const access = mapAccessModes(node.access, id, FEDAPP_ACCESS, issues);

  if (sectors.length === 0) {
    issues.push({
      code: "sector-use-missing-sector",
      message: "fedapp:SectorUse node has no fedapp:sector.",
      subject: id,
    });
  }
  if (access.length === 0) {
    issues.push({
      code: "sector-use-missing-access",
      message: "fedapp:SectorUse node requests no fedapp:access modes.",
      subject: id,
    });
  }

  return {
    id,
    sector: sectors[0] ?? "",
    access,
    consumes: validIris(node.consumes, id, FEDAPP_CONSUMES, issues),
    produces: validIris(node.produces, id, FEDAPP_PRODUCES, issues),
  };
}

/**
 * Filter a Set of object TERMS for an IRI-valued property down to the IRI string
 * values whose term is a `NamedNode`, recording an `invalid-term-type` issue for
 * every object that is NOT a NamedNode (a string literal or blank node where an
 * IRI is required is invalid — e.g. `fedapp:access "…acl#Read"` as a literal).
 */
function validIris(
  terms: ReadonlySet<TermWrapperType>,
  subject: string,
  predicate: string,
  issues: VerificationIssue[],
): string[] {
  const out: string[] = [];
  for (const term of terms) {
    if (term.termType !== "NamedNode") {
      issues.push({
        code: "invalid-term-type",
        message: `Expected an IRI (NamedNode) for <${predicate}> but found a ${term.termType} ("${term.value}").`,
        subject,
        value: term.value,
      });
      continue;
    }
    out.push(term.value);
  }
  return out;
}

/**
 * Validate + map access-mode object TERMS to short names. Rejects non-`NamedNode`
 * objects (via {@link validIris}) before checking each IRI is an `acl:` mode, so
 * a literal in `fedapp:access` position is flagged `invalid-term-type` rather than
 * silently accepted by its lexical value.
 */
function mapAccessModes(
  modeTerms: ReadonlySet<TermWrapperType>,
  subject: string,
  predicate: string,
  issues: VerificationIssue[],
): readonly ("Read" | "Write" | "Append" | "Control")[] {
  const out: ("Read" | "Write" | "Append" | "Control")[] = [];
  for (const iri of validIris(modeTerms, subject, predicate, issues)) {
    if (!VALID_ACCESS_MODE_IRIS.has(iri)) {
      issues.push({
        code: "invalid-access-mode",
        message: `Unknown fedapp:access value (not an acl: mode): ${iri}`,
        subject,
        value: iri,
      });
      continue;
    }
    const name = accessModeName(iri);
    if (name) {
      out.push(name);
    }
  }
  return out;
}

function isEmptyRegistration(r: AppRegistration): boolean {
  return (
    (r.sectors?.length ?? 0) === 0 &&
    (r.access?.length ?? 0) === 0 &&
    (r.consumes?.length ?? 0) === 0 &&
    (r.produces?.length ?? 0) === 0 &&
    (r.declaresShape?.length ?? 0) === 0 &&
    (r.sectorUse?.length ?? 0) === 0
  );
}

function describeError(err: unknown): string {
  if (err instanceof RdfFetchError) {
    return err.status
      ? `Failed to fetch registration (HTTP ${err.status}): ${err.message}`
      : `Failed to parse registration: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
