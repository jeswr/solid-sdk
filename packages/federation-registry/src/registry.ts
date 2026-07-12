// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The registry API: build a fedreg:Registry document (the registry operator's
// authoring path), and parse / list / verify the memberships in one (the
// consumer's discovery path). A fedreg:Membership is the REGISTRY's assertion that
// an app is a member — never trust a self-asserted fedapp:App as a membership
// claim. Parsing is via @jeswr/fetch-rdf (Turtle/JSON-LD conneg); extraction via
// the typed wrappers; serialisation via n3.Writer.

import type { DatasetCore, Quad } from "@rdfjs/types";
import { loadDataset } from "./load.js";
import { built } from "./serialize.js";
import type { Membership, MembershipVerification, Registry, RegistryIssue } from "./types.js";
import { membershipNodeToView, verifyMembershipNode } from "./verify.js";
import { MEMBERSHIP_STATUS, type MembershipStatusName } from "./vocab.js";
import { type MembershipNode, RegistryBuilder, type RegistryDataset, wrap } from "./wrappers.js";

/** A membership to author into a registry. */
export interface MembershipInput {
  /**
   * The membership record's IRI. Optional — when omitted a blank node is minted
   * (fine for a single document, but a stable IRI is preferable so the record can
   * be addressed / updated independently).
   */
  readonly id?: string;
  /** The app this membership concerns — its `client_id` IRI. */
  readonly app: string;
  /** Lifecycle status (default `Active`). */
  readonly status?: MembershipStatusName;
  /** The authority/authorities asserting this membership (WebID / key IRIs). */
  readonly assertedBy: string | readonly string[];
  /** When the assertion was made (`xsd:dateTime` lexical; default: now). */
  readonly asserted?: string;
}

/** Input to {@link buildRegistry}. */
export interface RegistryInput {
  /** The registry's IRI. */
  readonly id: string;
  /** The memberships to list. */
  readonly members: readonly MembershipInput[];
}

/** The output of {@link buildRegistry} / {@link buildMembership}. */
export interface BuiltGraph {
  /** The constructed quads. */
  readonly quads: readonly Quad[];
  /** Serialise to Turtle (default) or another n3 format. */
  toString(format?: string): Promise<string>;
}

function normaliseAssertedBy(v: string | readonly string[]): string[] {
  return typeof v === "string" ? [v] : [...v];
}

/**
 * Build a `fedreg:Registry` document listing the given memberships. This is the
 * registry operator's authoring path — each membership is the registry's OWN
 * assertion (it carries `fedreg:assertedBy`), so a consumer can trust the listing
 * as a membership claim rather than a bag of self-asserted app documents.
 */
export function buildRegistry(input: RegistryInput): BuiltGraph {
  if (!input.id) {
    throw new TypeError("buildRegistry: RegistryInput.id (the registry IRI) is required.");
  }
  const builder = new RegistryBuilder();
  const registry = builder.registry(input.id);
  for (const m of input.members) {
    writeMembership(registry.linkMember(m.id), m);
  }
  return built(builder.quads());
}

/**
 * Build a single standalone `fedreg:Membership` document (a registry that
 * addresses each membership as its own resource). `input.id` is required here (a
 * standalone record needs an IRI to be dereferenceable).
 */
export function buildMembership(input: MembershipInput & { id: string }): BuiltGraph {
  if (!input.id) {
    throw new TypeError(
      "buildMembership: a membership IRI (id) is required for a standalone record.",
    );
  }
  const builder = new RegistryBuilder();
  writeMembership(builder.membership(input.id), input);
  return built(builder.quads());
}

/** Shared writer for a membership node (used by both build paths). */
function writeMembership(
  node: ReturnType<RegistryBuilder["membership"]>,
  m: MembershipInput,
): void {
  node.addApp(m.app);
  node.addStatus(MEMBERSHIP_STATUS[m.status ?? "Active"]);
  for (const by of normaliseAssertedBy(m.assertedBy)) {
    node.addAssertedBy(by);
  }
  node.addAsserted(m.asserted ?? new Date().toISOString());
}

/** The result of {@link parseRegistry}. */
export interface ParsedRegistry {
  /** The parsed registry view (id + members), when a `fedreg:Registry` was found. */
  readonly registry?: Registry;
  /** Per-membership verification results, in document order. */
  readonly members: readonly MembershipVerification[];
  /** Whether every membership verified clean AND a registry node was found. */
  readonly valid: boolean;
  /** Document-level issues (no registry / multiple registries / fetch / parse). */
  readonly issues: readonly RegistryIssue[];
}

/** Options for the fetch-backed entry points. */
export interface FetchOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /** Verify a body already in hand instead of fetching. */
  readonly body?: string;
  /** Content-Type for {@link FetchOptions.body} (default `text/turtle`). */
  readonly bodyContentType?: string;
  /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
  readonly baseIRI?: string;
}

/** The document noun used in the registry path's load-error messages. */
const REGISTRY_NOUN = "registry document";

/**
 * Fetch (or accept) a `fedreg:Registry` document, parse it, and verify each
 * membership. Returns the registry view plus per-membership verification.
 */
export async function parseRegistry(
  input: string,
  options: FetchOptions = {},
): Promise<ParsedRegistry> {
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return { members: [], valid: false, issues: [loaded.issue] };
  }
  return parseRegistryDataset(loaded.dataset, input);
}

/** Verify an already-parsed dataset as a registry document. */
export function parseRegistryDataset(dataset: DatasetCore, expectedId?: string): ParsedRegistry {
  const fed: RegistryDataset = wrap(dataset);
  const registries = fed.registries();
  const issues: RegistryIssue[] = [];

  if (registries.length === 0) {
    issues.push({
      code: "no-registry",
      message: "No fedreg:Registry subject found in the document.",
      subject: expectedId,
    });
    return { members: [], valid: false, issues };
  }
  if (registries.length > 1) {
    issues.push({
      code: "multiple-registries",
      message: `Expected exactly one fedreg:Registry; found ${registries.length}.`,
      subject: expectedId,
    });
  }

  const registryNode = registries[0];
  const memberNodes = registryNode ? [...registryNode.members] : [];
  if (memberNodes.length === 0) {
    issues.push({
      code: "no-membership",
      message: "fedreg:Registry lists no fedreg:member records.",
      subject: registryNode?.value,
    });
  }

  const members = memberNodes.map((node) => verifyMembershipNode(node));
  const registry: Registry = {
    id: registryNode?.value ?? expectedId ?? "",
    members: members.map((m) => m.membership).filter((m): m is Membership => m !== undefined),
  };

  const valid = issues.length === 0 && members.every((m) => m.valid);
  return { registry, members, valid, issues };
}

/**
 * Discover the memberships in a registry document — a convenience over
 * {@link parseRegistry} returning just the per-membership verifications. Useful
 * for "which apps are members of this federation?".
 */
export async function listMembers(
  input: string,
  options: FetchOptions = {},
): Promise<MembershipVerification[]> {
  // Load the dataset ONCE; reuse it for both the registry parse and the
  // bare-membership fallback (never fetch the same resource twice — a second
  // fetch could observe a changed resource and adds avoidable network cost).
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return [];
  }
  const parsed = parseRegistryDataset(loaded.dataset, input);
  // Fall back to ANY fedreg:Membership in the (same) document when no Registry
  // node wraps them (a document that is a bare bag of membership records).
  if (parsed.members.length > 0 || parsed.issues.some((i) => i.code !== "no-registry")) {
    return [...parsed.members];
  }
  return wrap(loaded.dataset)
    .memberships()
    .map((node: MembershipNode) => verifyMembershipNode(node));
}

/**
 * Verify a single membership record document (or body). Returns the parsed
 * membership + issues. When the document is a registry, the FIRST membership is
 * verified; use {@link parseRegistry} / {@link listMembers} for multi-member docs.
 */
export async function verifyMembership(
  input: string,
  options: FetchOptions = {},
): Promise<MembershipVerification> {
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return { valid: false, issues: [loaded.issue] };
  }
  const fed = wrap(loaded.dataset);
  const memberships = fed.memberships();
  if (memberships.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "no-membership",
          message: "No fedreg:Membership subject found in the document.",
          subject: input,
        },
      ],
    };
  }
  const node = memberships[0] as MembershipNode;
  return verifyMembershipNode(node);
}

/**
 * Project + verify a single membership node from an already-parsed dataset (no
 * fetch). Exposed for callers who hold the dataset (e.g. a custom walk).
 */
export function verifyMembershipDataset(dataset: DatasetCore): MembershipVerification {
  const fed = wrap(dataset);
  const memberships = fed.memberships();
  if (memberships.length === 0) {
    return {
      valid: false,
      issues: [{ code: "no-membership", message: "No fedreg:Membership subject found." }],
    };
  }
  const issues: RegistryIssue[] = [];
  const membership = membershipNodeToView(memberships[0] as MembershipNode, issues);
  return { valid: issues.length === 0, membership, issues };
}
