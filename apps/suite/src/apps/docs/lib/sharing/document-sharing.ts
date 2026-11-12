// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { accessControl } from "../../../drive/lib/client/access";
import {
  applySharing,
  loadSharing,
  SharingRefreshError,
  type SharingSession,
  type SharingSnapshot,
  toGrants,
} from "../../../drive/lib/sharing/adapter";
import { SharingError } from "../../../drive/lib/sharing/rdf";
import type { SharingRole, SharingSelection } from "../../../drive/lib/sharing/types";
import {
  CHANGED_WHILE_SAVING,
  pinFetch,
  recordAccess,
  validator,
} from "../../../drive/lib/sharing/verify";
import { docContainerUrls } from "../model/layout";

export const DOCUMENT_PARTS_DIFFER =
  "Some parts of this document are shared differently. Saving will make them match.";
interface DocumentSharingSnapshot extends SharingSnapshot {
  readonly companions: readonly SharingSnapshot[];
  readonly pins: ReadonlyMap<string, string>;
}
const rank: Record<SharingRole | "none", number> = {
  none: 0,
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};
function signature(selection: SharingSelection): string {
  return JSON.stringify([
    selection.people.map(({ webId, role }) => [webId, role]).sort(),
    selection.link === "none" && selection.public === "viewer" ? "viewer" : selection.link,
  ]);
}

/** More members than this and the document's parts are not checked one by one. */
export const MAX_DOCUMENT_PARTS = 2000;
export const TOO_MANY_PARTS =
  "This document has too many parts to check its sharing. Share it from Drive instead.";

/**
 * Every member of the companion tree whose access is set on that member itself, in
 * breadth-first order so a parent always precedes its children. Members that only
 * inherit follow their governing container and need no separate write.
 */
async function ownPolicyParts(
  session: SharingSession,
  root: string,
  standard: ReadonlySet<string>,
): Promise<string[]> {
  const http = refuseRedirects(session.fetch);
  const access = accessControl(http, session.storageUrl);
  const found: string[] = [];
  const queue = [root];
  let seen = 0;
  while (queue.length) {
    const container = queue.shift() as string;
    const { dataset } = await fetchRdf(container, { fetch: http });
    const members = [...new Container(container, dataset, DataFactory).contains].map(
      (member) => member.id,
    );
    seen += members.length;
    if (seen > MAX_DOCUMENT_PARTS) throw new SharingError(TOO_MANY_PARTS);
    for (const member of members) {
      assertWithinPodScope(session.storageUrl, member);
      if (!member.startsWith(container) || member === container)
        throw new SharingError(`Couldn't check document part ${member}. Try again.`);
      // Policy documents themselves (a listing may show them) are not parts.
      if (/\.(acl|acr)$/.test(new URL(member).pathname)) continue;
      if (member.endsWith("/")) queue.push(member);
      const head = await http(member, { method: "HEAD" });
      if (!head.ok) throw new SharingError(`Couldn't check document part ${member}. Try again.`);
      // The standard containers are always parts, as before; any other member is one
      // only when it carries its own policy.
      if (standard.has(member)) {
        found.push(member);
        continue;
      }
      // Sharing reads the demo pod's policies too, so ignore Drive's demo opt-out here.
      const headers = new Headers(head.headers);
      headers.delete("x-solid-demo-access-control");
      const endpoint = access.discover(member, headers, true);
      if (!endpoint) throw new SharingError(`Couldn't check document part ${member}. Try again.`);
      const policy = await http(endpoint, { method: "HEAD" });
      if (policy.status === 404) continue;
      if (!policy.ok) throw new SharingError(`Couldn't check document part ${member}. Try again.`);
      found.push(member);
    }
  }
  return found;
}

/** The main resource drives the controls; every existing part is independently verified. */
export async function loadDocumentSharing(
  session: SharingSession,
  resource: string,
  /** Unpinned transport for listings, which are not access documents. */
  listing: SharingSession = session,
): Promise<DocumentSharingSnapshot> {
  const layout = docContainerUrls(resource);
  const pins = new Map<string, string>();
  const load = async (url: string) => {
    const recorder = recordAccess(session.fetch);
    const part = await loadSharing({ ...session, fetch: recorder.fetch }, url);
    for (const [url, validator] of recorder.validators()) {
      if (pins.has(url) && pins.get(url) !== validator)
        throw new SharingError(CHANGED_WHILE_SAVING);
      pins.set(url, validator);
    }
    return part;
  };
  const main = await load(resource);
  const companions = [await load(layout.container)];
  // Docs creates the companion containers lazily, and a member shared from Drive keeps
  // its own policy. Every part with its own policy is a part of this document's sharing.
  const standard = new Set([layout.updateLog, layout.assets, layout.comments, layout.versions]);
  const found = await ownPolicyParts(listing, layout.container, standard);
  // The standard containers first, in a fixed order; deeper parts after their parents.
  for (const url of [...[...standard].filter((url) => found.includes(url)), ...found])
    if (!companions.some((part) => part.resource === url)) companions.push(await load(url));
  const differs = companions.some((part) => signature(part.state) !== signature(main.state));
  const unmanaged = companions.find((part) => !part.canManage);
  return {
    ...main,
    companions,
    pins,
    canManage: main.canManage && !unmanaged,
    ...(unmanaged ? { readOnly: "Only an owner of every document part can change sharing." } : {}),
    ...(differs ? { notice: DOCUMENT_PARTS_DIFFER, needsSave: true } : {}),
  };
}

/**
 * After the companion root matches the selection, its inheritance is also part of this
 * plan. Permit edits to a child's own contribution; unrelated ancestor grants stay locked.
 * The SDK still refuses unrepresentable scope and verifies the complete effective result.
 */
function managedPart(part: SharingSnapshot, sources: ReadonlySet<string>): SharingSnapshot {
  const inheritedElsewhere = (id: string) =>
    part.grants.grants.some(
      (grant) =>
        grant.inherited &&
        !sources.has(grant.source) &&
        (grant.agent.type === "webid" ? grant.agent.id : grant.agent.type) === id,
    );
  return {
    ...part,
    state: {
      ...part.state,
      people: part.state.people.map((person) => ({
        ...person,
        inherited: person.inherited && inheritedElsewhere(person.webId),
      })),
      general: {
        ...part.state.general,
        inherited: part.state.general.inherited && inheritedElsewhere("public"),
      },
    },
  };
}

/** Remove/downgrade entry-point access without granting any of the new selection yet. */
function restricted(main: SharingSnapshot, selection: SharingSelection): SharingSelection {
  const people = selection.people.flatMap((person) => {
    const before = main.state.people.find(({ webId }) => webId === person.webId);
    return before
      ? [
          {
            webId: person.webId,
            role: rank[person.role] < rank[before.role] ? person.role : before.role,
          },
        ]
      : [];
  });
  const wanted =
    selection.link === "none" && selection.public === "viewer" ? "viewer" : selection.link;
  const link = rank[wanted] < rank[main.state.link] ? wanted : main.state.link;
  return { people, link, public: link === "none" ? "none" : "viewer" };
}

/**
 * One selection, resource scope on the entry point and folder scope on its companion tree.
 * Children with own policies are explicit targets, after their governing parent changes.
 * All persistence and read-back verification stay in Drive's SDK adapter.
 */
export async function applyDocumentSharing(
  session: SharingSession,
  snapshot: SharingSnapshot,
  selection: SharingSelection,
): Promise<DocumentSharingSnapshot> {
  const document = snapshot as DocumentSharingSnapshot;
  if (!document.canManage)
    throw new SharingError(document.readOnly ?? "Only an owner can change sharing");
  const [container, ...children] = document.companions;
  const root = container as SharingSnapshot;
  const targets = children.filter((part) => part.grants.grants.some((grant) => !grant.inherited));
  const sources = new Set(
    root.grants.grants.filter((grant) => !grant.inherited).map((grant) => grant.source),
  );
  const restriction = restricted(document, selection);
  // Validate the entire plan before the first write, including immutable owner/inherited rows.
  toGrants(session, document, restriction);
  toGrants(session, document, selection);
  toGrants(session, root, selection);
  for (const target of targets) toGrants(session, managedPart(target, sources), selection);
  // Refreshing a descendant after our parent write must not rebase over somebody else's
  // edits. Pin every access-document GET; only our accepted conditional PUTs advance pins.
  const pins = new Map(document.pins);
  const pinned = pinFetch(session.fetch, pins);
  // A server may accept a PUT without an ETag (CSS does). The next read of that document
  // is then the adapter's own verified reload, which must match the selection; it sets
  // the pin, and every later read must match it.
  const unconfirmed = new Set<string>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && unconfirmed.has(url)) {
      const response = await session.fetch(input, init);
      unconfirmed.delete(url);
      pins.set(url, validator(response));
      return response;
    }
    const response = await pinned(input, init);
    if (method !== "GET" && method !== "HEAD" && response.ok) {
      const etag = response.headers.get("etag");
      if (method === "PUT" && etag && !etag.startsWith("W/")) pins.set(url, `200 ${etag}`);
      else {
        pins.delete(url);
        unconfirmed.add(url);
      }
    }
    return response;
  };
  const applying = { ...session, fetch };
  let main: SharingSnapshot = document;
  const confirmed: string[] = [];
  let active = document.resource;
  try {
    if (toGrants(session, main, restriction)) {
      main = await applySharing(applying, main, restriction);
      confirmed.push(`document access reduced (${main.resource})`);
    }
    active = root.resource;
    const sharedRoot = await applySharing(applying, root, selection);
    for (const grant of sharedRoot.grants.grants) if (!grant.inherited) sources.add(grant.source);
    confirmed.push(`companion access matches the selection (${root.resource})`);
    for (const target of targets) {
      active = target.resource;
      const current = await loadSharing(applying, target.resource);
      await applySharing(applying, managedPart(current, sources), selection);
      confirmed.push(`companion access matches the selection (${target.resource})`);
    }
    active = main.resource;
    await applySharing(applying, main, selection);
    confirmed.push(`document access matches the selection (${main.resource})`);
    active = "final verification of all document parts";
    const fresh = await loadDocumentSharing(applying, main.resource, session);
    if (signature(fresh.state) !== signature(selection) || fresh.needsSave)
      throw new SharingError("Current document parts do not all match the selected access.");
    return fresh;
  } catch (cause) {
    // Discard controls after any partially applied or uncertain write. Retry reloads the
    // whole plan, showing the actual entry point and a Save repair action when parts differ.
    const error = new SharingRefreshError(cause, false);
    error.message = `Document sharing is incomplete. Confirmed: ${confirmed.length ? confirmed.join("; ") : "no targets"}. Not confirmed: ${active}. Later steps were not attempted. Retry to reload current access, then review and save again to finish.`;
    throw error;
  }
}
