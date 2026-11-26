// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { createConcurrentMapper } from "../../../../lib/parallel";
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
import { parseDocument } from "../model/document";
import { docContainerUrls } from "../model/layout";

export const DOCUMENT_PARTS_DIFFER =
  "Some parts of this document are shared differently. Saving will make them match.";
export const DOCUMENT_GROUPS_DIFFER =
  "Some parts of this document are shared with groups differently. Remove each listed group and share with it again so every part matches.";
export const REPAIR_FIRST =
  "Some parts of this document have their own sharing. Save to make them match before changing who has access.";
export const NOT_A_COMPANION =
  "This document's folder of updates, images and comments couldn't be confirmed, so it can't be shared here. Share it from Drive instead.";
export interface DocumentSharingSnapshot extends SharingSnapshot {
  readonly companions: readonly SharingSnapshot[];
  readonly pins: ReadonlyMap<string, string>;
  /** A part with its own, different access exists; only the repair Save may proceed. */
  readonly repairFirst?: boolean;
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
/** Group recipients and their strongest role, which the dialog's selection never carries. */
function groupSignature(part: SharingSnapshot): string {
  const groups = new Map<string, number>();
  for (const { agent, role } of part.grants.grants)
    if (agent.type === "group")
      groups.set(
        agent.id,
        Math.max(
          groups.get(agent.id) ?? 0,
          ["viewer", "commenter", "editor", "manager"].indexOf(role) + 1,
        ),
      );
  return JSON.stringify([...groups].sort());
}
function hasOwnGrants(part: SharingSnapshot): boolean {
  return part.grants.grants.some((grant) => !grant.inherited);
}
/** The companion root governs inheriting children. Remove the entry point last. */
export function documentGroupTargets(snapshot: SharingSnapshot): string[] {
  const companions = (snapshot as Partial<DocumentSharingSnapshot>).companions ?? [];
  const targets = companions.filter((part, index) => index === 0 || hasOwnGrants(part));
  return [snapshot.resource, ...targets.map((part) => part.resource)];
}
function relative(root: string, url: string): string {
  return url.startsWith(root) && url !== root ? url.slice(root.length) : "the document folder";
}

/** More members than this and the document's parts are not checked one by one. */
export const MAX_DOCUMENT_PARTS = 2000;
/**
 * Update-log entries accumulate until compaction, and recovery leaves older `updates-*`
 * logs behind. They are still checked, but against this larger cap of their own so a
 * long-lived document keeps its sharing.
 */
export const MAX_LOG_ENTRIES = 20000;
export const TOO_MANY_PARTS =
  "This document has too many parts to check its sharing. Share it from Drive instead.";
/** Parallel requests while checking the companion tree. */
const PART_CHECKS = 8;

/**
 * Every member of the companion tree whose access is set on that member itself, in
 * breadth-first order so a parent always precedes its children. Members that only
 * inherit follow their governing container and need no separate write. Each level's
 * listings and checks run concurrently, bounded by PART_CHECKS.
 */
async function ownPolicyParts(
  session: SharingSession,
  root: string,
  standard: ReadonlySet<string>,
  hasCompanionLinks: boolean,
): Promise<string[]> {
  const http = refuseRedirects(session.fetch);
  const access = accessControl(http, session.storageUrl);
  const map = createConcurrentMapper(PART_CHECKS);
  const isLog = (container: string) => /^updates(?:-[^/]*)?\/$/.test(container.slice(root.length));
  const found: string[] = [];
  let level = [root];
  let seen = 0;
  let logged = 0;
  const failed = (member: string) =>
    new SharingError(`Couldn't check document part ${member}. Try again.`);
  const check = async (member: string): Promise<boolean> => {
    const head = await http(member, { method: "HEAD" });
    if (!head.ok) throw failed(member);
    // The standard containers are always parts, as before; any other member is one
    // only when it carries its own policy.
    if (standard.has(member)) return true;
    // Sharing reads the demo pod's policies too, so ignore Drive's demo opt-out here.
    const headers = new Headers(head.headers);
    headers.delete("x-solid-demo-access-control");
    const endpoint = access.discover(member, headers, true);
    if (!endpoint) throw failed(member);
    const policy = await http(endpoint, { method: "HEAD" });
    if (policy.status === 404) return false;
    if (!policy.ok) throw failed(member);
    return true;
  };
  while (level.length) {
    const listed = await map(level, async (container) => {
      const { dataset } = await fetchRdf(container, { fetch: http });
      return {
        container,
        members: [...new Container(container, dataset, DataFactory).contains].map(
          (member) => member.id,
        ),
      };
    });
    const members: string[] = [];
    for (const { container, members: contained } of listed) {
      if (!hasCompanionLinks && container === root) {
        // Linkless Docs use updates/ by default. Only recognise the Docs layout at the root.
        const known = (url: string) =>
          standard.has(url) || isLog(url) || url === `${root}.acl` || url === `${root}.acr`;
        if (!contained.includes(`${root}updates/`) || !contained.every(known))
          throw new SharingError(NOT_A_COMPANION);
      }
      for (const member of contained) {
        assertWithinPodScope(session.storageUrl, member);
        if (!member.startsWith(container) || member === container) throw failed(member);
        // Policy documents themselves (a listing may show them) are not parts.
        if (/\.(acl|acr)$/.test(new URL(member).pathname)) continue;
        if (isLog(container) && !member.endsWith("/")) logged++;
        else seen++;
        members.push(member);
      }
      if (seen > MAX_DOCUMENT_PARTS || logged > MAX_LOG_ENTRIES)
        throw new SharingError(TOO_MANY_PARTS);
    }
    const own = await map(members, check);
    found.push(...members.filter((_, index) => own[index]));
    level = members.filter((member) => member.endsWith("/"));
  }
  return found;
}

/**
 * The companion is `<slug>/` beside `<slug>.ttl` by naming alone. A document moved without
 * its folder, or a `.ttl` that is not a Docs document, would otherwise apply folder-scoped
 * sharing to an unrelated same-named folder. Refuse non-Docs files and out-of-folder
 * links. When no links are recorded, the tree walk must confirm the legacy layout.
 */
async function checkCompanionLinks(session: SharingSession, resource: string, container: string) {
  let links: (string | undefined)[];
  try {
    const { dataset } = await fetchRdf(resource, { fetch: refuseRedirects(session.fetch) });
    const document = parseDocument(resource, dataset);
    if (!document) throw new SharingError(NOT_A_COMPANION);
    links = [document.updateLog, document.assets, document.comments];
  } catch (cause) {
    if (cause instanceof SharingError) throw cause;
    throw new SharingError(`Couldn't check document part ${resource}. Try again.`, { cause });
  }
  if (
    links.some((link) => link !== undefined && (!link.startsWith(container) || link === container))
  )
    throw new SharingError(NOT_A_COMPANION);
  return links.some((link) => link !== undefined);
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
  const hasCompanionLinks = await checkCompanionLinks(listing, resource, layout.container);
  const main = await load(resource);
  const companions = [await load(layout.container)];
  // Docs creates the companion containers lazily, and a member shared from Drive keeps
  // its own policy. Every part with its own policy is a part of this document's sharing.
  const standard = new Set([layout.updateLog, layout.assets, layout.comments, layout.versions]);
  const found = await ownPolicyParts(listing, layout.container, standard, hasCompanionLinks);
  // The standard containers first, in a fixed order; deeper parts after their parents.
  for (const url of [...[...standard].filter((url) => found.includes(url)), ...found])
    if (!companions.some((part) => part.resource === url)) companions.push(await load(url));
  const differing = companions.filter((part) => signature(part.state) !== signature(main.state));
  const groupsDiffer = companions.filter((part) => groupSignature(part) !== groupSignature(main));
  const unmanaged = companions.find((part) => !part.canManage);
  const name = (parts: readonly SharingSnapshot[]) =>
    parts.map((part) => relative(layout.container, part.resource)).join(", ");
  const notice = [
    ...(differing.length
      ? [`${DOCUMENT_PARTS_DIFFER} Shared differently: ${name(differing)}.`]
      : []),
    ...(groupsDiffer.length
      ? [`${DOCUMENT_GROUPS_DIFFER} Shared differently: ${name(groupsDiffer)}.`]
      : []),
  ].join(" ");
  return {
    ...main,
    companions,
    pins,
    // Only a repair Save may rewrite a member that was given its own, different access.
    ...(differing.some(
      (part) =>
        part.resource !== layout.container && (!standard.has(part.resource) || hasOwnGrants(part)),
    )
      ? { repairFirst: true }
      : {}),
    canManage: main.canManage && !unmanaged,
    ...(unmanaged ? { readOnly: "Only an owner of every document part can change sharing." } : {}),
    ...(notice ? { notice } : {}),
    ...(differing.length ? { needsSave: true } : {}),
  };
}

/**
 * The Share button's permission decision: owner of the entry point and of its companion
 * folder. The whole companion tree is checked only when the dialog opens.
 */
export async function checkDocumentSharing(
  session: SharingSession,
  resource: string,
): Promise<Pick<SharingSnapshot, "canManage" | "readOnly">> {
  const [main, root] = await Promise.all([
    loadSharing(session, resource),
    loadSharing(session, docContainerUrls(resource).container),
  ]);
  if (!main.canManage)
    return { canManage: false, ...(main.readOnly ? { readOnly: main.readOnly } : {}) };
  return root.canManage
    ? { canManage: true }
    : { canManage: false, readOnly: "Only an owner of every document part can change sharing." };
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
 * Best effort, after a failed plan: bring companion parts that may already hold the new
 * selection back to the document's reduced access, deepest first, so nobody keeps the
 * document's content through its folder (versions/ holds full copies) without the
 * document itself. Every write stays pinned; a concurrent change stops the revert.
 */
async function revert(
  session: SharingSession,
  widened: readonly SharingSnapshot[],
  root: string,
  sources: ReadonlySet<string>,
  restriction: SharingSelection,
): Promise<string> {
  const failed: string[] = [];
  for (const part of [...widened].reverse()) {
    try {
      const current = await loadSharing(session, part.resource);
      await applySharing(
        session,
        part.resource === root ? current : managedPart(current, sources),
        restriction,
      );
    } catch {
      failed.push(part.resource);
    }
  }
  if (!widened.length) return "";
  return failed.length
    ? ` Access added to ${failed.join(", ")} could not be reverted; review it in Drive.`
    : " Access added to the document's other parts was reverted.";
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
  if (document.repairFirst && signature(selection) !== signature(document.state))
    throw new SharingError(REPAIR_FIRST);
  const [container, ...children] = document.companions;
  const root = container as SharingSnapshot;
  const targets = children.filter(hasOwnGrants);
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
  // Companion parts written with the selection before the document itself was. If the
  // document write then fails, these would grant more than the document does.
  const widened: SharingSnapshot[] = [];
  let documentShared = false;
  try {
    if (toGrants(session, main, restriction)) {
      main = await applySharing(applying, main, restriction);
      confirmed.push(`document access reduced (${main.resource})`);
    }
    active = root.resource;
    widened.push(root);
    const sharedRoot = await applySharing(applying, root, selection);
    for (const grant of sharedRoot.grants.grants) if (!grant.inherited) sources.add(grant.source);
    confirmed.push(`companion access matches the selection (${root.resource})`);
    for (const target of targets) {
      active = target.resource;
      const current = await loadSharing(applying, target.resource);
      widened.push(target);
      await applySharing(applying, managedPart(current, sources), selection);
      confirmed.push(`companion access matches the selection (${target.resource})`);
    }
    active = main.resource;
    await applySharing(applying, main, selection);
    documentShared = true;
    confirmed.push(`document access matches the selection (${main.resource})`);
    active = "final verification of all document parts";
    const fresh = await loadDocumentSharing(applying, main.resource, session);
    if (signature(fresh.state) !== signature(selection) || fresh.needsSave)
      throw new SharingError("Current document parts do not all match the selected access.");
    return fresh;
  } catch (cause) {
    // Discard controls after any partially applied or uncertain write. Retry reloads the
    // whole plan, showing the actual entry point and a Save repair action when parts differ.
    const reverted =
      !documentShared && signature(restriction) !== signature(selection)
        ? await revert(applying, widened, root.resource, sources, restriction)
        : "";
    const error = new SharingRefreshError(cause, false);
    error.message = `Document sharing is incomplete. Confirmed: ${confirmed.length ? confirmed.join("; ") : "no targets"}. Not confirmed: ${active}. Later steps were not attempted.${reverted} Retry to reload current access, then review and save again to finish.`;
    throw error;
  }
}
