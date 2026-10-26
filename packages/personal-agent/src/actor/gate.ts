// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Actor's programmatic permission gate — the `canUseTool` callback (§3.3), a SECOND
 * fence on top of `permissionMode: "dontAsk"` + the tool allowlist. Its job is the one
 * thing the allowlist alone cannot express: per-CONTAINER write scoping. The Actor may
 * READ the pod (list/read/search) and may WRITE ONLY into the proposals container — it
 * PROPOSES, it never executes, and it can never write outside that one container (so it
 * can neither rewrite a provenance anchor nor touch its own mandate).
 *
 * FAIL-CLOSED by construction: anything not explicitly a read tool or a proposals-scoped
 * write is DENIED (Bash / Write / Edit / WebFetch / any unknown tool). A write whose input
 * carries no in-scope URL — or ANY URL outside the proposals container — is denied.
 *
 * The returned {@link GateDecision} is a subset of the Claude Agent SDK's `PermissionResult`,
 * so the live Actor wires it directly as `canUseTool`.
 */
import { isWithinBase } from "@jeswr/agentic-legacy-bridge";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { isSafeContainer, type PodFetch } from "../config.js";
import { parseProposal, proposalUrl, serializeProposal } from "../pod/proposals.js";

/** The gate verdict (a `PermissionResult` subset). */
export type GateDecision =
  | { readonly behavior: "allow"; readonly updatedInput?: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string; readonly interrupt?: boolean };

/** The read-only pod MCP tools the Actor may always use. */
export const POD_READ_TOOLS = [
  "mcp__pod__solid_list",
  "mcp__pod__solid_read",
  "mcp__pod__solid_search",
] as const;

/** The single proposals-container write tool (a second, narrowly-scoped MCP server). */
export const PROPOSAL_WRITE_TOOL = "mcp__proposals__solid_write";

/** Config for {@link createGate}. */
export interface GateConfig {
  /** The ONLY container a write may target (the proposals container). */
  readonly proposalsContainer: string;
  /** The allowed read tools (default {@link POD_READ_TOOLS}). */
  readonly readTools?: readonly string[];
  /** The allowed proposals write tool (default {@link PROPOSAL_WRITE_TOOL}). */
  readonly writeTool?: string;
  /** Read credentials used to discover the container/resource's access-control links. */
  readonly discoveryFetch?: PodFetch;
}

/** The gate function: `(toolName, input) → allow | deny`. */
export type Gate = (
  toolName: string,
  input: Record<string, unknown>,
) => GateDecision | Promise<GateDecision>;

const DENY_UNKNOWN: GateDecision = {
  behavior: "deny",
  message: "tool not permitted for the Actor (read-only + proposals-container writes only)",
};

/**
 * Collect every http(s) URL string ANYWHERE in the input (recursing into nested objects
 * and arrays, depth-bounded). solid_write's schema is flat, but scanning the whole input
 * is strictly safer: no URL a write carries can be out of scope, wherever it sits.
 */
function urlValues(input: unknown, depth = 0): string[] {
  const urls: string[] = [];
  if (depth > 6 || input == null) return urls;
  if (typeof input === "string") {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") urls.push(input);
    } catch {
      // not a URL — ignore
    }
    return urls;
  }
  if (Array.isArray(input)) {
    for (const item of input) urls.push(...urlValues(item, depth + 1));
    return urls;
  }
  if (typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      urls.push(...urlValues(value, depth + 1));
    }
  }
  return urls;
}

const ACP_ACCESS_CONTROL = "http://www.w3.org/ns/solid/acp#accessControl";
const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const CONTAINERS = new Set(
  ["Container", "BasicContainer", "DirectContainer", "IndirectContainer"].map(
    (name) => `${LDP}${name}`,
  ),
);

function hasContainer(store: DatasetCore): boolean {
  return [...store.match(null, RDF_TYPE, null)].some((q) => CONTAINERS.has(q.object.value));
}

function controlResource(iri: string, base: string): string {
  const url = new URL(iri, base);
  url.hash = "";
  return url.href;
}

/** Split Link values outside quoted parameters and IRI references. */
function linkValues(header: string): string[] {
  const values: string[] = [];
  let start = 0;
  let quoted = false;
  let angled = false;
  let escaped = false;
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (!angled && char === '"') quoted = !quoted;
    if (!quoted && char === "<") angled = true;
    if (!quoted && char === ">") angled = false;
    if (!quoted && !angled && char === ",") {
      values.push(header.slice(start, i));
      start = i + 1;
    }
  }
  values.push(header.slice(start));
  return values;
}

function discoverLinks(header: string, base: string, blocked: Set<string>): boolean {
  let container = false;
  for (const value of linkValues(header)) {
    const target = /^\s*<([^>]*)>/.exec(value)?.[1];
    if (target === undefined) continue;
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(value);
    const relations = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
    const url = new URL(target, base).href;
    if (relations.includes("acl") || relations.includes(ACP_ACCESS_CONTROL))
      blocked.add(controlResource(url, base));
    if (relations.includes("type") && CONTAINERS.has(url)) container = true;
  }
  return container;
}

async function discover(
  fetchFn: PodFetch,
  url: string,
  blocked: Set<string>,
  allowMissing: boolean,
): Promise<boolean> {
  const response = await fetchFn(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/turtle" },
  });
  const container = discoverLinks(response.headers.get("link") ?? "", url, blocked);
  if (response.status === 404 && allowMissing) return container;
  if (!response.ok || response.redirected || (response.url && response.url !== url)) {
    throw new Error("access-control discovery failed");
  }
  // Turtle avoids remote JSON-LD context loading at this untrusted boundary.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle") {
    throw new Error("discovery requires RDF Turtle");
  }
  const store = await parseRdf(await response.text(), contentType, { baseIRI: url });
  for (const q of store.match(null, DataFactory.namedNode(ACP_ACCESS_CONTROL), null)) {
    if (q.object.termType === "NamedNode") blocked.add(controlResource(q.object.value, url));
  }
  return container || hasContainer(store);
}

/**
 * Build the fail-closed gate. Deny-by-default: a read tool → allow; the write tool → allow
 * ONLY for a validated Turtle proposal inside the proposals container, after discovering
 * and excluding ACL/ACP resources and containers. Discovery failures deny the write.
 */
export function createGate(config: GateConfig): Gate {
  const readTools = new Set(config.readTools ?? POD_READ_TOOLS);
  const writeTool = config.writeTool ?? PROPOSAL_WRITE_TOOL;
  const base = config.proposalsContainer;
  const blocked = new Set<string>();

  return async (toolName, input) => {
    if (readTools.has(toolName)) return { behavior: "allow" };
    if (toolName === writeTool) {
      const urls = urlValues(input ?? {});
      if (urls.length === 0) {
        return { behavior: "deny", message: "write refused: no in-scope target URL" };
      }
      const allWithin = urls.every((url) => isWithinBase(url, base));
      if (!allWithin) {
        return {
          behavior: "deny",
          message: "write refused: target escapes the proposals container",
        };
      }
      try {
        if (!isSafeContainer(base) || typeof input.url !== "string")
          throw new Error("invalid target");
        const target = new URL(input.url);
        if (
          target.href !== input.url ||
          target.search ||
          target.hash ||
          target.username ||
          target.password ||
          target.pathname.endsWith("/") ||
          /\.(acl|acr)$/i.test(decodeURIComponent(target.pathname))
        ) {
          throw new Error("access-control or container target");
        }
        if (
          typeof input.contentType !== "string" ||
          input.contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle" ||
          typeof input.content !== "string"
        ) {
          throw new Error("proposal writes require RDF Turtle");
        }
        const store = await parseRdf(input.content, input.contentType, { baseIRI: target.href });
        const proposal = parseProposal(store);
        if (hasContainer(store) || !proposal || proposalUrl(base, proposal.id) !== target.href) {
          throw new Error("invalid proposal record or container write");
        }
        if (!config.discoveryFetch) throw new Error("access-control discovery fetch required");
        await discover(config.discoveryFetch, base, blocked, false);
        const isContainer = await discover(config.discoveryFetch, target.href, blocked, true);
        if (blocked.has(target.href) || isContainer)
          throw new Error("access-control or container target");
        // Write only the validated record: extra RDF supplied by the Actor never reaches the pod.
        return {
          behavior: "allow",
          updatedInput: {
            url: target.href,
            contentType: "text/turtle",
            content: await serializeProposal(proposal, { resourceUrl: target.href }),
          },
        };
      } catch {
        return {
          behavior: "deny",
          message:
            "write refused: requires a validated proposal resource without access-control or container scope",
        };
      }
    }
    return DENY_UNKNOWN;
  };
}
