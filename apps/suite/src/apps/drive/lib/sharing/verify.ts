// AUTHORED-BY Claude Opus 5.5
// Independent re-read of the access documents the SDK role layer just fetched. The SDK's
// readGrants drops every principal whose modes map to no role (public Read+Append, Write
// without Read, …) and reads a folder's own rules without its acl:default /
// acp:memberAccessControl rules. Neither may let Drive claim that access is narrower than
// it is, so this module re-derives the raw effective modes with the SDK's neutral readers
// (readWac/readAcp) and refuses anything the role projection did not account for.
import { parseRdf } from "@jeswr/fetch-rdf";
import { type Mode, readAcp, readWac, type Subject } from "@jeswr/pod-access";
import { modesToRole, type ResourceKind, type RoleGrant } from "@jeswr/pod-access/roles";
import type { DatasetCore } from "@rdfjs/types";
import { SharingError } from "./rdf";

const ACP = "http://www.w3.org/ns/solid/acp#";
const ESS_MODES = new Set(["Read", "Write", "Append"].map((mode) => ACP + mode));
export const UNMAPPED =
  "This item's sharing includes access that this dialog can't show, so it can't be changed here.";
export const UNSUPPORTED_SYSTEM = "This pod's access system isn't supported for sharing yet.";

/** One access document the SDK read, with the resource whose Link advertised it. */
export interface AccessCapture {
  readonly resource: string;
  readonly url: string;
  readonly dataset: DatasetCore;
}
interface Call {
  readonly method: string;
  readonly url: string;
  readonly response: Response;
}

/**
 * Wrap a fetch to keep a copy of every access-document response it serves. The SDK walks
 * HEAD resource → GET its advertised access document, so each GET is attributed to the
 * HEAD before it; `verifyAccess` re-checks that attribution and fails closed on a mismatch.
 */
export function recordAccess(fetch: typeof globalThis.fetch) {
  const calls: Call[] = [];
  return {
    fetch: (async (input, init) => {
      const response = await fetch(input, init);
      calls.push({ method: init?.method ?? "GET", url: String(input), response: response.clone() });
      return response;
    }) as typeof globalThis.fetch,
    /** The existing access documents, parsed. Only call after the SDK read succeeded. */
    async documents(target: string): Promise<AccessCapture[]> {
      const documents: AccessCapture[] = [];
      let resource = target;
      for (const call of calls) {
        if (call.method === "HEAD") resource = call.url;
        else if (call.response.status !== 404)
          documents.push({
            resource,
            url: call.url,
            dataset: await parseRdf(
              await call.response.text(),
              call.response.headers.get("content-type"),
              { baseIRI: call.url },
            ),
          });
      }
      return documents;
    },
  };
}

/** Whether a document the SDK could not read uses ESS's acp:* access modes. */
export function usesEssModes(documents: readonly AccessCapture[]): boolean {
  return documents.some((document) =>
    [...document.dataset].some((quad) => ESS_MODES.has(quad.object.value)),
  );
}

function isAcp(dataset: DatasetCore): boolean {
  return [...dataset].some(
    (quad) => quad.predicate.value.startsWith(ACP) || quad.object.value.startsWith(ACP),
  );
}
function principal(subject: Subject): string {
  return subject.kind === "agent" ? subject.webId : subject.kind;
}
function governs(resource: string, target: string): boolean {
  return resource === target || (resource.endsWith("/") && target.startsWith(resource));
}

/** Raw modes per principal: own rules in `scope`, ancestor rules through their member scope. */
function effective(
  target: string,
  documents: readonly AccessCapture[],
  scope: "resource" | "members",
): Map<string, Set<Mode>> {
  const rows = new Map<string, Set<Mode>>();
  for (const document of documents) {
    if (!governs(document.resource, target)) throw new SharingError(UNMAPPED);
    const policy = isAcp(document.dataset)
      ? readAcp(document.dataset, document.resource, document.url, "css")
      : readWac(document.dataset, document.resource, document.url, "css");
    if (policy.denials.length) throw new SharingError(UNMAPPED);
    const applies = document.resource === target ? scope : "members";
    for (const rule of policy.grants) {
      if (rule.appliesTo !== applies && rule.appliesTo !== "both") continue;
      if (rule.except.length || rule.who.some((clause) => clause.length !== 1))
        throw new SharingError(UNMAPPED);
      for (const [subject] of rule.who as Subject[][])
        for (const mode of rule.modes) {
          const id = principal(subject as Subject);
          rows.set(id, (rows.get(id) ?? new Set<Mode>()).add(mode));
        }
    }
  }
  return rows;
}
function normalized(modes: ReadonlySet<Mode> | undefined): string {
  const values = new Set(modes);
  if (values.has("write")) values.add("append");
  return [...values].sort().join(" ");
}

function check(
  target: string,
  kind: ResourceKind,
  documents: readonly AccessCapture[],
  grants: readonly RoleGrant[],
): { contentsDiffer: boolean } {
  const own = effective(target, documents, "resource");
  const roles = new Map(
    grants.map((grant) => [
      grant.agent.type === "webid" ? grant.agent.id : grant.agent.type,
      grant.role,
    ]),
  );
  if (
    own.size !== roles.size ||
    [...own].some(([id, modes]) => roles.get(id) !== (modesToRole(modes, kind) ?? null))
  )
    throw new SharingError(UNMAPPED);
  if (kind !== "folder") return { contentsDiffer: false };
  const members = effective(target, documents, "members");
  return {
    contentsDiffer: [...new Set([...own.keys(), ...members.keys()])].some(
      (id) => normalized(own.get(id)) !== normalized(members.get(id)),
    ),
  };
}

/**
 * Throw `SharingError` unless every principal with effective access on `target` is in
 * `grants` at the role its raw modes map to, and nobody else is; any parse or reader failure
 * fails closed the same way. For a folder, also report whether its contents' effective
 * access (member rules) differs from the folder's own.
 */
export async function verifyAccess(
  target: string,
  kind: ResourceKind,
  documents: () => Promise<readonly AccessCapture[]>,
  grants: readonly RoleGrant[],
): Promise<{ contentsDiffer: boolean }> {
  try {
    return check(target, kind, await documents(), grants);
  } catch (error) {
    throw error instanceof SharingError ? error : new SharingError(UNMAPPED, { cause: error });
  }
}
