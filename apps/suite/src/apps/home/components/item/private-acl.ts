// AUTHORED-BY Claude Opus 5.5
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { readResource, serializeTurtle } from "../../lib/model/rdf";
import { ACL, AccessNode } from "../../lib/permissions/vocab";
import { accessSystem, aclLink, acpHeaders, readWacPolicy } from "../../lib/permissions/walk";

export interface PrivateAclSession {
  storageUrl: string;
  webId: string;
  fetch: typeof fetch;
}
export class PrivateAccessError extends Error {}
const OWNER_MODES = ["read", "write", "control"] as const;

function parentOf(url: string, storage: string): string | undefined {
  return url === storage ? undefined : new URL(url.endsWith("/") ? ".." : ".", url).href;
}

/**
 * A resource that does not exist yet may not advertise its ACL. Accept the
 * conventional `<resource>.acl` only when the nearest existing ancestor proves the
 * server uses that convention; anything else fails closed.
 */
async function aclEndpoint(session: PrivateAclSession, target: string, head: Response) {
  const advertised = aclLink(head.headers, target);
  if (advertised) return advertised;
  for (
    let url = parentOf(target, session.storageUrl);
    url !== undefined;
    url = parentOf(url, session.storageUrl)
  ) {
    const response = await session.fetch(url, { method: "HEAD", redirect: "error" });
    if (response.status === 404) continue;
    if (!response.ok || acpHeaders(response.headers)) break;
    if (aclLink(response.headers, url) === `${url}.acl`) return `${target}.acl`;
    break;
  }
  throw new PrivateAccessError("Couldn't find where to protect your settings.");
}

/** Every authorization names only the owner; together they give Read, Write and Control. */
function verifyOwnerOnly(
  session: PrivateAclSession,
  target: string,
  endpoint: string,
  read: Awaited<ReturnType<typeof readResource>>,
  headers: Headers,
) {
  let policy: ReturnType<typeof readWacPolicy>;
  try {
    if (accessSystem(read.dataset, endpoint, headers) !== "wac") throw new Error("Not WAC");
    policy = readWacPolicy(read.dataset, target, endpoint);
  } catch {
    throw new PrivateAccessError("Couldn't verify private access to your settings.");
  }
  const modes = new Set(policy.grants.flatMap((grant) => [...grant.modes]));
  if (
    policy.denials.length > 0 ||
    !OWNER_MODES.every((mode) => modes.has(mode)) ||
    policy.grants.some(
      (grant) =>
        grant.except.length > 0 ||
        grant.who.length === 0 ||
        grant.who.some(
          (clause) =>
            clause.length !== 1 || clause[0]?.kind !== "agent" || clause[0].webId !== session.webId,
        ),
    )
  )
    throw new PrivateAccessError(
      "Your settings aren't private to you. Check who can see them, then try again.",
    );
}

/**
 * Before a private settings document is first written, give it its own owner-only
 * ACL so it never inherits a public or shared parent policy. The ACL is created
 * create-only (If-None-Match: *) so an existing policy is never replaced, then read
 * back and verified. Any failure throws before the document is written or linked.
 * Returns the ACL document that now governs the target.
 */
export async function ensurePrivateAcl(
  session: PrivateAclSession,
  target: string,
): Promise<string> {
  assertWithinPodScope(session.storageUrl, target);
  const head = await session.fetch(target, { method: "HEAD", redirect: "error" });
  if ((!head.ok && head.status !== 404) || acpHeaders(head.headers))
    throw new PrivateAccessError("Couldn't set up private access to your settings.");
  const endpoint = assertWithinPodScope(
    session.storageUrl,
    await aclEndpoint(session, target, head),
  );
  let read: Awaited<ReturnType<typeof readResource>>;
  try {
    read = await readResource(session.fetch, endpoint);
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    const dataset = new Store();
    const owner = new AccessNode(`${endpoint}#owner`, dataset, DataFactory);
    owner.values(`${NS.RDF}type`).add(`${ACL}Authorization`);
    owner.values(`${ACL}accessTo`).add(target);
    owner.values(`${ACL}agent`).add(session.webId);
    for (const mode of ["Read", "Write", "Control"]) owner.values(`${ACL}mode`).add(ACL + mode);
    const created = await session.fetch(endpoint, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: await serializeTurtle(dataset),
    });
    // 412: another writer created it first; the read-back below verifies whatever won.
    if (!created.ok && created.status !== 412)
      throw new PrivateAccessError("Couldn't protect your settings.");
    read = await readResource(session.fetch, endpoint);
  }
  verifyOwnerOnly(session, target, endpoint, read, head.headers);
  return endpoint;
}

/**
 * After the first write, confirm the server governs the document with the ACL that
 * was verified, and that it reports no public access.
 */
export async function verifyPrivateDocument(
  session: PrivateAclSession,
  target: string,
  endpoint: string,
): Promise<void> {
  const head = await session.fetch(target, { method: "HEAD", redirect: "error" });
  const advertised = aclLink(head.headers, target);
  const publicModes = /(?:^|,)\s*public\s*=\s*"([^"]*)"/i.exec(head.headers.get("wac-allow") ?? "");
  if (
    !head.ok ||
    acpHeaders(head.headers) ||
    (advertised !== undefined && advertised !== endpoint) ||
    /\b(?:read|append|write)\b/i.test(publicModes?.[1] ?? "")
  )
    throw new PrivateAccessError("Couldn't verify private access to your settings.");
}
