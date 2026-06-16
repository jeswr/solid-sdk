// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// verifyDescriptor(...) — fetch (or accept) an ANP Agent Description document and
// validate it: exactly one ad:AgentDescription, a name + a valid url, well-formed
// owner / protocolSource IRIs, skills with id + name (no duplicate ids), and
// security schemes of a known type. Parsing is via @jeswr/fetch-rdf (Turtle /
// JSON-LD conneg); extraction via the typed wrappers. A FETCHED document is bound
// (the subject-match spoofing guard) to `expectedId` when supplied — for the
// well-known serving pattern where the URL ≠ the agent IRI it describes —
// otherwise to the URL it was served from.

import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import type {
  AgentDescriptor,
  AgentSkill,
  SecurityScheme,
  VerificationIssue,
  VerificationResult,
} from "./types.js";
import { type SecuritySchemeType, VALID_SECURITY_SCHEME_TYPES } from "./vocab.js";
import {
  type AgentDescriptionNode,
  type SecuritySchemeNode,
  type SkillNode,
  type TermWrapperType,
  wrapAgent,
} from "./wrappers.js";

/** Options for {@link verifyDescriptor}. */
export interface VerifyOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Skip the network and verify an RDF body already in hand. When set, `input`
   * is treated as the document base IRI (not a URL to fetch) and
   * `bodyContentType` selects the parser.
   */
  readonly body?: string;
  /** Content-Type for {@link VerifyOptions.body} (default `text/turtle`). */
  readonly bodyContentType?: string;
  /** Base IRI to resolve relative IRIs when parsing a body (default `input`). */
  readonly baseIRI?: string;
  /**
   * Require the single `ad:AgentDescription` subject to equal `input` (the
   * expected agent IRI) — so a document served at URL A cannot cleanly describe a
   * different agent B (a spoofing vector). Defaults to `true` for a FETCHED
   * document and `false` for an in-hand `body`. Set explicitly to override.
   */
  readonly requireSubjectMatch?: boolean;
  /**
   * The expected agent subject IRI when verifying a `body`. ANP descriptions are
   * commonly served at the WebID/profile fragment `#ad` while the agent subject
   * is the agent IRI; supply it to enable subject-binding for an in-hand body.
   */
  readonly expectedId?: string;
}

/** Options for {@link verifyDataset}. */
export interface VerifyDatasetOptions {
  /** Require the single `ad:AgentDescription` subject to equal `expectedId`. */
  readonly requireSubjectMatch?: boolean;
}

/**
 * Verify an agent description.
 *
 * @param input - the description document URL (fetched + parsed) OR, when
 *   `options.body` is set, the base IRI for the supplied body.
 */
export async function verifyDescriptor(
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
    return {
      valid: false,
      issues: [{ code: classifyFetchError(err), message: describeError(err), subject: input }],
    };
  }

  // The subject the document is bound to:
  //  - a FETCHED document binds to `expectedId` if the caller supplied one (an
  //    ANP description is commonly served at a well-known URL while its RDF
  //    subject is the agent IRI), otherwise to the fetch `input` URL;
  //  - an in-hand `body` binds to `expectedId` only (there is no fetch URL).
  const expectedId = isBody ? options.expectedId : (options.expectedId ?? input);
  const requireSubjectMatch =
    options.requireSubjectMatch ?? (!isBody || options.expectedId !== undefined);
  return verifyDataset(dataset, expectedId, { requireSubjectMatch });
}

/**
 * Verify an already-parsed dataset. Exposed so callers who fetched the RDF
 * themselves (e.g. inside {@link import("./discover.js").discoverAgent}) avoid a
 * second fetch.
 */
export function verifyDataset(
  dataset: DatasetCore,
  expectedId?: string,
  options: VerifyDatasetOptions = {},
): VerificationResult {
  const agentDs = wrapAgent(dataset);
  const descriptions = agentDs.agentDescriptions();
  const issues: VerificationIssue[] = [];

  if (descriptions.length === 0) {
    issues.push({
      code: "no-agent-description",
      message: "No ad:AgentDescription subject found in the document.",
      subject: expectedId,
    });
    return { valid: false, issues };
  }
  if (descriptions.length > 1) {
    issues.push({
      code: "multiple-agent-descriptions",
      message: `Expected exactly one ad:AgentDescription; found ${descriptions.length}.`,
      subject: expectedId,
    });
  }

  const node = descriptions[0] as AgentDescriptionNode;

  if (options.requireSubjectMatch && expectedId !== undefined && node.value !== expectedId) {
    issues.push({
      code: "subject-mismatch",
      message: `ad:AgentDescription subject (${node.value}) does not equal the expected agent IRI (${expectedId}).`,
      subject: node.value,
      value: expectedId,
    });
  }

  const descriptor = projectDescriptor(node, issues);
  return { valid: issues.length === 0, descriptor, issues };
}

/** Project an {@link AgentDescriptionNode} to a plain descriptor, recording issues. */
function projectDescriptor(
  node: AgentDescriptionNode,
  issues: VerificationIssue[],
): AgentDescriptor {
  const id = node.value;
  const name = firstLiteral(node.names);
  if (name === undefined) {
    issues.push({
      code: "missing-name",
      message: "ad:AgentDescription has no ad:name.",
      subject: id,
    });
  }

  const urlIris = iriValues(node.urls, id, "ad:url", issues);
  const url = urlIris[0];
  if (url === undefined) {
    issues.push({
      code: "missing-url",
      message: "ad:AgentDescription has no ad:url.",
      subject: id,
    });
  } else if (!isHttpUrl(url)) {
    issues.push({
      code: "invalid-url",
      message: `ad:url is not an http(s) URL: ${url}`,
      subject: id,
      value: url,
    });
  }

  const owner = iriValues(node.owners, id, "ad:owner", issues)[0];
  const protocolSources = iriValues(node.protocolSources, id, "ad:protocolSource", issues);
  for (const ps of protocolSources) {
    if (!isHttpUrl(ps)) {
      issues.push({
        code: "invalid-protocol-source",
        message: `ad:protocolSource is not an http(s) URL: ${ps}`,
        subject: id,
        value: ps,
      });
    }
  }

  const skills = projectSkills(node, issues);
  const securitySchemes = projectSchemes(node, issues);

  return {
    id,
    name: name ?? "",
    ...(firstLiteral(node.descriptions) !== undefined && {
      description: firstLiteral(node.descriptions),
    }),
    ...(url !== undefined && { url }),
    ...(owner !== undefined && { owner }),
    ...(firstLiteral(node.dids) !== undefined && { did: firstLiteral(node.dids) }),
    ...(skills.length > 0 && { skills }),
    ...(securitySchemes.length > 0 && { securitySchemes }),
    ...(protocolSources.length > 0 && { protocolSources }),
  };
}

/** Project + validate the linked skills, recording issues (incl. duplicate ids). */
function projectSkills(node: AgentDescriptionNode, issues: VerificationIssue[]): AgentSkill[] {
  const out: AgentSkill[] = [];
  const seen = new Set<string>();
  for (const sk of node.skills as Set<SkillNode>) {
    const skillId = firstLiteral(sk.skillId);
    const name = firstLiteral(sk.names);
    if (skillId === undefined) {
      issues.push({
        code: "skill-missing-id",
        message: "ad:Skill has no ad:skillId.",
        subject: sk.value,
      });
      continue;
    }
    if (name === undefined) {
      issues.push({
        code: "skill-missing-name",
        message: "ad:Skill has no ad:name.",
        subject: sk.value,
        value: skillId,
      });
    }
    if (seen.has(skillId)) {
      issues.push({
        code: "duplicate-skill-id",
        message: `Duplicate ad:skillId: ${skillId}`,
        subject: sk.value,
        value: skillId,
      });
      continue;
    }
    seen.add(skillId);
    out.push({
      id: skillId,
      name: name ?? "",
      ...(firstLiteral(sk.descriptions) !== undefined && {
        description: firstLiteral(sk.descriptions),
      }),
    });
  }
  return out;
}

/** Project + validate the linked security schemes, recording issues. */
function projectSchemes(node: AgentDescriptionNode, issues: VerificationIssue[]): SecurityScheme[] {
  const out: SecurityScheme[] = [];
  for (const sc of node.securitySchemes as Set<SecuritySchemeNode>) {
    const type = firstLiteral(sc.schemeTypes);
    if (type === undefined || !VALID_SECURITY_SCHEME_TYPES.has(type)) {
      issues.push({
        code: "invalid-security-scheme",
        message: `ad:SecurityScheme has an unknown or missing ad:schemeType: ${type ?? "(none)"}`,
        subject: sc.value,
        ...(type !== undefined && { value: type }),
      });
      continue;
    }
    const issuer = [...sc.urls].find((t) => t.termType === "NamedNode")?.value;
    out.push({
      type: type as SecuritySchemeType,
      ...(issuer !== undefined && { issuer }),
      ...(firstLiteral(sc.descriptions) !== undefined && {
        description: firstLiteral(sc.descriptions),
      }),
    });
  }
  return out;
}

/** The first Literal value in a term set, or `undefined`. */
function firstLiteral(terms: ReadonlySet<TermWrapperType>): string | undefined {
  for (const term of terms) {
    if (term.termType === "Literal") {
      return term.value;
    }
  }
  return undefined;
}

/**
 * Filter a term set to NamedNode IRI string values, recording an `invalid-owner`
 * issue for the owner predicate and a generic mismatch elsewhere when a non-IRI
 * (literal / blank node) sits where an IRI is required.
 */
function iriValues(
  terms: ReadonlySet<TermWrapperType>,
  subject: string,
  label: string,
  issues: VerificationIssue[],
): string[] {
  const out: string[] = [];
  for (const term of terms) {
    if (term.termType !== "NamedNode") {
      issues.push({
        code: label === "ad:owner" ? "invalid-owner" : "invalid-url",
        message: `Expected an IRI (NamedNode) for ${label} but found a ${term.termType} ("${term.value}").`,
        subject,
        value: term.value,
      });
      continue;
    }
    out.push(term.value);
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Classify a fetch/parse error into the right issue code. An {@link RdfFetchError}
 * carries discriminator fields: an HTTP `status` ⇒ the request reached the server
 * but it answered non-2xx (`fetch-failed`); a `contentType` WITHOUT a status ⇒ we
 * received a response but could not parse that media type (`parse-failed`); neither
 * ⇒ a transport/network failure (`fetch-failed`). A non-RdfFetchError is treated as
 * a parse failure (it surfaced from the parser, not the transport).
 */
export function classifyFetchError(err: unknown): "fetch-failed" | "parse-failed" {
  if (err instanceof RdfFetchError) {
    if (err.status !== undefined) {
      return "fetch-failed";
    }
    return err.contentType !== undefined ? "parse-failed" : "fetch-failed";
  }
  return "parse-failed";
}

function describeError(err: unknown): string {
  if (err instanceof RdfFetchError) {
    return err.status
      ? `Failed to fetch agent description (HTTP ${err.status}): ${err.message}`
      : `Failed to parse agent description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
