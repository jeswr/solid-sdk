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
import { accessModeName, VALID_ACCESS_MODE_IRIS } from "./vocab.js";
import { type AppNode, type FederationDataset, type SectorUseNode, wrap } from "./wrappers.js";

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

  return verifyDataset(dataset, input);
}

/**
 * Verify an already-parsed dataset. Exposed so callers who fetched the RDF
 * themselves (e.g. inside {@link list}) avoid a second fetch.
 *
 * @param dataset - the parsed RDF graph.
 * @param expectedId - the document URL, used to pick the app subject when
 *   several `fedapp:App` nodes are present is NOT done — multiple Apps is an
 *   issue; this is only used to scope error messages.
 */
export function verifyDataset(dataset: DatasetCore, expectedId?: string): VerificationResult {
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

  // verify() treats a registration document as describing ONE app: it projects
  // and validates the first fedapp:App (a >1 count is already flagged above as a
  // `multiple-apps` issue). Use list() for multi-app registry documents, which
  // verifies each app independently via verifyApp().
  const result = verifyApp(apps[0] as AppNode);
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
  const access = mapAccessModes(app.access, app.value, issues);
  const sectorUse = [...app.sectorUses].map((node) => sectorUseNodeToView(node, issues));

  return {
    id: app.value,
    sectors: [...app.sectors],
    access,
    consumes: [...app.consumes],
    produces: [...app.produces],
    declaresShape: [...app.declaresShape],
    sectorUse,
  };
}

/** Project a {@link SectorUseNode} into a {@link SectorUse} view, recording issues. */
function sectorUseNodeToView(node: SectorUseNode, issues: VerificationIssue[]): SectorUse {
  const id = node.value;
  const sectors = [...node.sectors];
  const access = mapAccessModes(node.access, id, issues);

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
    consumes: [...node.consumes],
    produces: [...node.produces],
  };
}

/** Validate + map access-mode IRIs to short names, recording invalid ones. */
function mapAccessModes(
  modeIris: ReadonlySet<string>,
  subject: string,
  issues: VerificationIssue[],
): readonly ("Read" | "Write" | "Append" | "Control")[] {
  const out: ("Read" | "Write" | "Append" | "Control")[] = [];
  for (const iri of modeIris) {
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
