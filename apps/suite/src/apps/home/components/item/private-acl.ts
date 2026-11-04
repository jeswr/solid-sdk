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
/** The server would not create an ACL for a resource that does not exist yet. */
class AclRefusedError extends PrivateAccessError {}
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
    if ([404, 405, 409].includes(created.status))
      throw new AclRefusedError("Couldn't protect your settings.");
    // 412: another writer created it first; the read-back below verifies whatever won.
    if (!created.ok && created.status !== 412)
      throw new PrivateAccessError("Couldn't protect your settings.");
    read = await readResource(session.fetch, endpoint);
  }
  verifyOwnerOnly(session, target, endpoint, read, head.headers);
  return endpoint;
}

/**
 * Prepare a private settings document that does not exist yet for its first write.
 * The default protects it ACL-first, so the document never exists without its own ACL.
 * A server that refuses an ACL for a missing resource (404, 405 or 409) gets the
 * fallback: create the document EMPTY (If-None-Match: *), so nothing is exposed while
 * it inherits the parent's access, then install and verify the owner-only ACL. The
 * returned ETag is the empty document's, for an If-Match content write. If the ACL step
 * fails, the empty document is deleted (If-Match) and the error is rethrown; a
 * concurrent creator (412) stops without touching the other writer's document.
 */
export async function preparePrivateDocument(
  session: PrivateAclSession,
  target: string,
): Promise<{ acl: string; etag?: string }> {
  try {
    return { acl: await ensurePrivateAcl(session, target) };
  } catch (error) {
    if (!(error instanceof AclRefusedError)) throw error;
  }
  const created = await session.fetch(target, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: "",
  });
  if (created.status === 412)
    throw new PrivateAccessError("Your settings changed while Home set them up. Try again.");
  if (!created.ok) throw new PrivateAccessError("Couldn't set up private access to your settings.");
  const etag =
    created.headers.get("etag") ??
    (await session.fetch(target, { method: "HEAD", redirect: "error" })).headers.get("etag");
  try {
    if (!etag) throw new PrivateAccessError("Couldn't set up private access to your settings.");
    return { acl: await ensurePrivateAcl(session, target), etag };
  } catch (error) {
    await discardEmptyDocument(session, target, etag);
    throw error;
  }
}

/** Best-effort removal of a document this flow created, never someone else's newer version. */
export async function discardEmptyDocument(
  session: PrivateAclSession,
  target: string,
  etag: string | null,
): Promise<void> {
  await session
    .fetch(target, {
      method: "DELETE",
      redirect: "error",
      ...(etag ? { headers: { "if-match": etag } } : {}),
    })
    .catch(() => undefined);
}

/** Whether a response's `WAC-Allow` header grants the public any access. */
export function publiclyAccessible(headers: Headers): boolean {
  const modes = /(?:^|,)\s*public\s*=\s*"([^"]*)"/i.exec(headers.get("wac-allow") ?? "");
  return /\b(?:read|append|write)\b/i.test(modes?.[1] ?? "");
}

export class PublicFolderError extends Error {
  constructor() {
    super(
      "Anyone with the link can see this folder, so Home won't add a private item to it. Make the folder private, then try again.",
    );
  }
}

/**
 * Refuse to put a new item where the public could read it: the nearest existing folder
 * (whose access the new item inherits) must not report public access. A server that
 * reports no `WAC-Allow` can't be checked here and is allowed, as before; the created
 * item is checked again after its write.
 */
export async function assertFolderNotPublic(
  session: PrivateAclSession,
  container: string,
): Promise<void> {
  for (
    let url: string | undefined = assertWithinPodScope(session.storageUrl, container);
    url !== undefined;
    url = parentOf(url, session.storageUrl)
  ) {
    const response = await session.fetch(url, { method: "HEAD", redirect: "error" });
    if (response.status === 404) continue;
    if (publiclyAccessible(response.headers)) throw new PublicFolderError();
    return;
  }
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
  if (
    !head.ok ||
    acpHeaders(head.headers) ||
    (advertised !== undefined && advertised !== endpoint) ||
    publiclyAccessible(head.headers)
  )
    throw new PrivateAccessError("Couldn't verify private access to your settings.");
}
