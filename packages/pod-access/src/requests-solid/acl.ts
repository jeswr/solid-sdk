// AUTHORED-BY Codex GPT-6
// Port of access-manager's own/nearest-ancestor ACL, create-only materialisation,
// set-semantics grants and bounded If-Match retry logic.
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { addGrant, planAddGrant } from "../roles/client.js";
import { put, read, scoped, transport } from "./http.js";
import type { RequestMode } from "./inbox.js";
import { set, turtle, values } from "./rdf.js";
import { ACCM, ACL, LDP } from "./vocab.js";

export class UnsupportedAccessModelError extends Error {
  constructor(readonly model: "acp" | "unknown") {
    super(`Cannot materialise access requests on an ${model} access model`);
    this.name = "UnsupportedAccessModelError";
  }
}

/** Inspect the target's Link headers. ACP wins if both models are advertised. */
export async function accessModel(options: {
  fetch: typeof fetch;
  target?: string;
  storage: string;
  signal?: AbortSignal;
}): Promise<"wac" | "acp" | "unknown"> {
  const target = scoped(options.storage, options.target ?? options.storage);
  const response = await transport(options.fetch, options.signal)(target, { method: "HEAD" });
  if (!response.ok) throw new Error(`Access model discovery failed (${response.status})`);
  const links = response.headers.get("link") ?? "";
  if (link(links, "http://www.w3.org/ns/solid/acp#accessControl", target)) return "acp";
  return link(links, "acl", target) ? "wac" : "unknown";
}

/** Authoritative bounded parsing: quoted parameters and foreign anchors cannot select an ACL. */
function link(header: string, relation: string, base: string): string | undefined {
  return parseLinkHeaders(header, base, { onOverflow: "throw", maxResolvedBytes: 32768 }).find(
    (entry) => entry.context === base && entry.rel.includes(relation.toLowerCase()),
  )?.target;
}

async function aclUrl(resource: string, storage: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(resource, { method: "HEAD" });
  const header = response.headers.get("link") ?? "";
  if (link(header, "http://www.w3.org/ns/solid/acp#accessControl", resource))
    throw new UnsupportedAccessModelError("acp");
  const target = link(header, "acl", resource);
  return scoped(storage, target === undefined ? `${resource}.acl` : new URL(target, resource).href);
}

function authSubject(auth: Authorization) {
  return auth.termType === "BlankNode"
    ? DataFactory.blankNode(auth.value)
    : DataFactory.namedNode(auth.value);
}

/** The modes each sharing role grants on a WAC resource or folder. */
export const ROLE_MODES: Readonly<Record<"viewer" | "editor", readonly RequestMode[]>> =
  Object.freeze({
    viewer: Object.freeze(["read"] as const),
    editor: Object.freeze(["append", "read", "write"] as const),
  });

/**
 * The sharing role an approval grants for requested `modes`. Grants are roles, the suite's sharing
 * vocabulary: a request to change data is approved as Editor (which also lets the requester view
 * it), a read request as Viewer. Append-only requests have no matching role and are refused.
 */
export function roleFor(modes: readonly RequestMode[]): "viewer" | "editor" {
  if (modes.includes("write")) return "editor";
  if (modes.includes("read")) return "viewer";
  throw new Error(
    "This request only asks to add data, which no sharing role allows on its own, so it can't be approved",
  );
}

/**
 * Grant `agent` the role matching `modes` on `target` through the `./roles` layer (SDK-APP-04):
 * additive (never downgrades), conditional on every write, materialising a missing own ACL with
 * the owner's access kept. Refusals (for example `unsupported` or `owner-lockout`) are rethrown
 * unchanged for the caller to show; they are never retried here.
 */
export async function applyGrant(
  target: string,
  storage: string,
  owner: string,
  agent: string,
  modes: readonly RequestMode[],
  fetchFn: typeof fetch,
): Promise<void> {
  const result = await addGrant(...grantArgs(target, storage, owner, agent, modes, fetchFn));
  const failure = result.failed[0];
  if (failure) throw failure.error;
}

/** Throws whatever refusal `applyGrant` would hit for this target, without writing anything. */
export async function checkGrant(
  target: string,
  storage: string,
  owner: string,
  agent: string,
  modes: readonly RequestMode[],
  fetchFn: typeof fetch,
): Promise<void> {
  await planAddGrant(...grantArgs(target, storage, owner, agent, modes, fetchFn));
}

function grantArgs(
  target: string,
  storage: string,
  owner: string,
  agent: string,
  modes: readonly RequestMode[],
  fetchFn: typeof fetch,
): Parameters<typeof addGrant> {
  scoped(storage, target);
  return [
    [target],
    { agent: { type: "webid", id: agent }, role: roleFor(modes), inherited: false, source: target },
    {
      fetch: fetchFn,
      webId: owner,
      root: storage,
      model: "wac",
      kind: target.endsWith("/") ? "folder" : "resource",
    },
  ];
}

/** On a records folder ACL: the folder was made private but not yet shown to be empty. */
const UNVERIFIED = `${ACCM.ns}unverifiedRecords`;
/**
 * On a sealed records folder ACL: a random key that names the decision records inside. Only the
 * owner (Control) can read an ACL, so nobody else can know a record's URL, and nothing written
 * before the folder was sealed can sit at one.
 */
const RECORDS_KEY = `${ACCM.ns}recordsKey`;

/**
 * Make sure a records container is readable and writable by the owner alone before anything is
 * written into, or trusted from, it. An existing ACL must name no one but the owner, and give the
 * owner Read, Write and Control over the folder and everything in it; otherwise the decision
 * stops, because grant records and receipts list recipients, purposes and targets, and pinned
 * decisions are trusted on recovery.
 *
 * A folder without its own ACL may have inherited someone else's write access, so anything
 * already inside it is untrusted. It is made private only while it lists as empty, with an ACL
 * that marks it unverified; it is trusted once it still lists as empty after that, and the mark is
 * then removed with a conditional write. Only someone with Control can write the ACL, so a crash
 * or a failed check leaves the mark in place and every later call checks again (and keeps
 * refusing while anything is inside).
 */
export async function ensureOwnerOnlyContainer(
  container: string,
  storage: string,
  owner: string,
  fetchFn: typeof fetch,
): Promise<string> {
  scoped(storage, container);
  const head = await fetchFn(container, { method: "HEAD" });
  if (head.status === 404) await put(container, "", fetchFn, null, true);
  else if (!head.ok) throw new Error(`Records folder check failed (${head.status})`);
  const url = await aclUrl(container, storage, fetchFn);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await read(url, fetchFn);
    if (!existing) {
      await assertEmpty(container, url, fetchFn);
      // Created or lost a create race: either way, re-read and verify on the next pass.
      await put(url, await ownerOnlyAcl(url, container, owner), fetchFn, null, true);
      continue;
    }
    const acl = new AclResource(existing.dataset, DataFactory);
    const own = new Set<string>();
    const inherited = new Set<string>();
    for (const auth of acl.authorizations) {
      const subject = authSubject(auth);
      const agents = values(existing.dataset, subject, ACL.agent);
      if (
        agents.some((agent) => agent !== owner) ||
        values(existing.dataset, subject, ACL.agentClass).length > 0 ||
        values(existing.dataset, subject, ACL.agentGroup).length > 0
      ) {
        throw new Error("The access records folder is shared; make it private first");
      }
      if (!agents.includes(owner)) continue;
      const modes = values(existing.dataset, subject, ACL.mode);
      if (values(existing.dataset, subject, ACL.accessTo).includes(container))
        for (const mode of modes) own.add(mode);
      if (values(existing.dataset, subject, ACL.default).includes(container))
        for (const mode of modes) inherited.add(mode);
    }
    const full = (modes: Set<string>) =>
      [ACL.Read, ACL.Write, ACL.Control].every((mode) => modes.has(mode));
    if (!full(own) || !full(inherited))
      throw new Error("The access records folder does not give you full control");
    const key = values(existing.dataset, url, RECORDS_KEY)[0];
    const unverified = values(existing.dataset, url, UNVERIFIED).length > 0;
    if (!unverified && key !== undefined) return key;
    // Anything that arrived before the folder became private is untrusted. The key is minted only
    // now, after the folder is known to be private, so nothing written earlier can sit at a name
    // derived from it (a key found next to the unverified mark was not written by us).
    if (unverified) await assertEmpty(container, url, fetchFn);
    const sealed = crypto.randomUUID();
    set(existing.dataset, url, UNVERIFIED, undefined);
    set(existing.dataset, url, RECORDS_KEY, sealed);
    if (await put(url, await turtle(existing.dataset), fetchFn, existing.etag)) return sealed;
  }
  throw new Error("The access records folder ACL kept changing");
}

/**
 * The records key of an already private records folder, sealing it first if needed; undefined
 * while the folder or its ACL does not exist yet (so no decision record can exist either). Writes
 * nothing to a pod without a records folder ACL.
 */
export async function recordsKey(
  container: string,
  storage: string,
  owner: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  scoped(storage, container);
  const head = await fetchFn(container, { method: "HEAD" });
  if (head.status === 404) return undefined;
  if (!head.ok) throw new Error(`Records folder check failed (${head.status})`);
  if (!(await read(await aclUrl(container, storage, fetchFn), fetchFn))) return undefined;
  return ensureOwnerOnlyContainer(container, storage, owner, fetchFn);
}

async function ownerOnlyAcl(url: string, container: string, owner: string): Promise<string> {
  const dataset = new Store();
  const auth = new Authorization(`${url}#owner`, dataset, DataFactory);
  auth.type.add(ACL.Authorization);
  auth.agent.add(owner);
  auth.accessTo = container;
  auth.default = container;
  for (const mode of [ACL.Read, ACL.Write, ACL.Control]) auth.mode.add(mode);
  set(dataset, url, UNVERIFIED, "true");
  return turtle(dataset);
}

/** Fails closed: a folder that cannot be listed is not known to be empty. */
async function assertEmpty(container: string, acl: string, fetchFn: typeof fetch): Promise<void> {
  const listing = await read(container, fetchFn);
  if (!listing)
    throw new Error("The access records folder can't be listed, so it can't be checked");
  const members = values(listing.dataset, container, LDP.contains);
  if (members.some((member) => member !== acl))
    throw new Error(
      "The access records folder already has files but isn't private; review and clear it first",
    );
}
