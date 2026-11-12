// AUTHORED-BY Codex GPT-6.1-Sol

import { refuseRedirects } from "@jeswr/guarded-fetch";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { peopleWac, preserveGroupWac, wacGroupIds } from "@jeswr/suite-groups";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import {
  ShareError,
  type ShareRole,
  type SharingAdapter,
  type SharingState,
} from "../../../../shell/share/types";
import { WacSharingAdapter, wacShareCapabilities } from "../../../../shell/share/wac-adapter";
import { readSharing, SharingError } from "../../../drive/lib/sharing";
import { ModelError } from "../model/errors";
import { RdfIO, type Resource, requireEtag } from "../model/io";
import { requireProjectFolder } from "../model/rdf";
import { TaskTracker } from "../model/tracker";

const ACL = "http://www.w3.org/ns/auth/acl#";
export const tasksShareCapabilities = {
  ...wacShareCapabilities,
  publicLinks: false,
  notifyAgents: false,
  accessRequests: false,
};
class Grant extends Authorization {
  values(predicate: string) {
    return SetFrom.subjectPredicate(
      this,
      ACL + predicate,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
/** A complete, restricted ACL. Owners always retain Read, Write and Control. */
function policy(folder: string, people: SharingState["people"]) {
  const dataset = new Store();
  for (const person of people) {
    const grant = new Grant(DataFactory.blankNode(), dataset, DataFactory);
    grant.type.add(`${ACL}Authorization`);
    grant.values("accessTo").add(folder);
    if (folder.endsWith("/")) grant.values("default").add(folder);
    grant.values("agent").add(person.webId);
    grant.mode.add(`${ACL}Read`);
    if (person.role !== "viewer") grant.mode.add(`${ACL}Write`);
    if (person.role === "owner") grant.mode.add(`${ACL}Control`);
  }
  return dataset;
}
interface Options {
  fetch: typeof fetch;
  webId: string;
  trackerUrl: string;
  folderUrl: string;
  projectsContainer?: string | undefined;
  ensurePrivate: (url: string, owner: string) => Promise<boolean>;
  syncMembers: (webId: string, granted: boolean) => Promise<void>;
}
type Reconcile = "none" | "narrow" | "all";
type People = SharingState["people"];
/** Named grants only: narrow folder → tracker → folder; re-read to recover partial writes. */
export class TasksSharingAdapter implements SharingAdapter {
  readonly caps = tasksShareCapabilities;
  readonly supportsCommenter = false;
  readonly supportsGeneralCommenter = false;
  private readonly fetch: typeof fetch;
  private readonly io: RdfIO;
  private readonly tracker: WacSharingAdapter;
  private tail: Promise<unknown> = Promise.resolve();
  // A failed write may still commit after its recovery read. Only an explicit action may widen.
  private unconfirmedChange = false;
  constructor(private readonly options: Options) {
    this.fetch = refuseRedirects(options.fetch);
    this.io = new RdfIO(this.fetch);
    this.tracker = new WacSharingAdapter({ fetch: this.fetch, webId: options.webId });
  }
  private validate(url: string) {
    const { trackerUrl, folderUrl, webId } = this.options;
    for (const value of [trackerUrl, folderUrl, webId]) {
      if (safeHttpIri(value) !== value) throw new ShareError("unsupported");
      const parsed = new URL(value);
      if (parsed.username || parsed.password || parsed.search) throw new ShareError("unsupported");
    }
    if (url !== trackerUrl) throw new ShareError("unsupported");
    try {
      requireProjectFolder(trackerUrl, folderUrl, this.options.projectsContainer);
    } catch {
      throw new ShareError("unsupported");
    }
  }
  private async acl(resource: string, signal: AbortSignal) {
    const response = await this.fetch(resource, { method: "HEAD", signal });
    if (!response.ok) throw new ShareError(response.status === 403 ? "forbidden" : "network");
    // Limit direct ACL writes to the conventional, same-resource auxiliary document.
    const links = [...(response.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel="acl"/g)];
    const target = links[0]?.[1];
    if (links.length !== 1 || !target || new URL(target, resource).href !== `${resource}.acl`)
      throw new ShareError("unsupported");
    return this.io.optional(`${resource}.acl`);
  }
  private state(resource: string, document: Resource): SharingState {
    requireEtag(document.etag);
    const current = readSharing({
      access: {
        resource,
        documents: [
          {
            model: "wac",
            dataset: peopleWac(document.dataset),
            source: document.url,
            governingResource: resource,
            inherited: false,
          },
        ],
      },
    });
    if (current.link !== "none") throw new ShareError("unsupported");
    const groups = wacGroupIds(document.dataset, resource, document.url);
    return {
      ...(groups.length ? { groups } : {}),
      people: current.people.map(({ webId, role }) => ({ webId, role })),
      general: { mode: "restricted" },
      canManage: current.people.some(
        (person) => person.webId === this.options.webId && person.role === "owner",
      ),
    };
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation).catch((error: unknown) => {
      throw this.error(error);
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  load(url: string, signal: AbortSignal): Promise<SharingState> {
    return this.enqueue(() =>
      this.readState(url, signal, this.unconfirmedChange ? "narrow" : "all", false, true),
    );
  }
  private async readState(
    url: string,
    signal: AbortSignal,
    reconcile: Reconcile,
    forceFolderWrite = false,
    warnOnMembersFailure = false,
  ): Promise<SharingState> {
    this.validate(url);
    try {
      const document = await this.io.read(url);
      const tracker = new TaskTracker(`${url}#this`, document.dataset, DataFactory);
      if (!tracker.isTracker || tracker.stateStore !== this.options.folderUrl)
        throw new ShareError("unsupported");
      const acl = await this.acl(url, signal);
      const folder = await this.acl(this.options.folderUrl, signal);
      const folderState = folder ? this.state(this.options.folderUrl, folder) : undefined;
      if (
        !folder &&
        !(await this.options.ensurePrivate(this.options.folderUrl, this.options.webId))
      )
        throw new ShareError("unsupported");
      if (!acl) {
        if (
          !(await this.options.ensurePrivate(url, this.options.webId)) ||
          folderState?.people.some((person) => person.webId !== this.options.webId)
        )
          throw new ShareError("unsupported");
        signal.throwIfAborted();
        await this.io.write(
          `${url}.acl`,
          policy(url, [{ webId: this.options.webId, role: "owner" }]),
          { create: true },
        );
      } else this.state(url, acl);
      const state = await this.tracker.load(url, signal);
      if (reconcile !== "none" && state.canManage && !state.readOnly) {
        try {
          await this.reconcile(
            state,
            folder,
            tracker.groupMembers,
            signal,
            reconcile,
            forceFolderWrite,
          );
        } catch (error) {
          if (
            !(warnOnMembersFailure && error instanceof ShareError && error.code === "members-sync")
          )
            throw error;
          return { ...state, warning: "members-sync" };
        }
      }
      return state;
    } catch (error) {
      throw this.error(error);
    }
  }
  private folderState(folder: Resource | undefined): SharingState {
    return folder
      ? this.state(this.options.folderUrl, folder)
      : {
          people: [{ webId: this.options.webId, role: "owner" }],
          general: { mode: "restricted" },
          canManage: true,
        };
  }
  private requireFolderControl(existing: SharingState, tracker: SharingState) {
    if (!existing.canManage) throw new ShareError("forbidden");
    // A folder-only Control holder cannot be reconstructed from tracker grants.
    if (
      existing.people.some(
        (person) =>
          person.role === "owner" &&
          !tracker.people.some((entry) => entry.webId === person.webId && entry.role === "owner"),
      )
    )
      throw new ShareError("conflict");
  }
  /** Intersection never introduces another owner's Control before the tracker commits. */
  private intersect(people: People, existing: People, next: People = people): People {
    return people.flatMap((person) => {
      const after = next.find((entry) => entry.webId === person.webId);
      const old = existing.find((entry) => entry.webId === person.webId);
      if (person.role === "owner")
        return person.webId === this.options.webId || old?.role === "owner" ? [person] : [];
      if (!after || !old) return [];
      return [
        {
          ...person,
          role:
            person.role === "editor" && after.role === "editor" && old.role === "editor"
              ? ("editor" as const)
              : ("viewer" as const),
        },
      ];
    });
  }
  private samePeople(left: People, right: People): boolean {
    return (
      left.length === right.length &&
      left.every((person) =>
        right.some((entry) => entry.webId === person.webId && entry.role === person.role),
      )
    );
  }
  private async reconcile(
    state: SharingState,
    folder: Resource | undefined,
    members: string[],
    signal: AbortSignal,
    mode: Exclude<Reconcile, "none">,
    forceFolderWrite: boolean,
  ) {
    if (state.general.mode !== "restricted") throw new ShareError("forbidden");
    const folderUrl = this.options.folderUrl;
    const existing = this.folderState(folder);
    this.requireFolderControl(existing, state);
    const lower = this.intersect(state.people, existing.people);
    signal.throwIfAborted();
    if (folder && !this.samePeople(lower, existing.people)) {
      folder = await this.io.write(
        `${folderUrl}.acl`,
        preserveGroupWac(policy(folderUrl, lower), folder.dataset),
        {
          etag: folder.etag,
        },
      );
    }
    try {
      // Only an owner reaches this path. A failed change repairs revocations without widening.
      if (mode === "all" && (forceFolderWrite || !this.samePeople(lower, state.people))) {
        await this.io.write(
          `${folderUrl}.acl`,
          folder
            ? preserveGroupWac(policy(folderUrl, state.people), folder.dataset)
            : policy(folderUrl, state.people),
          folder ? { etag: folder.etag } : { create: true },
        );
      }
    } finally {
      // Once narrowed, membership must converge even if widening conflicts or loses its response.
      await this.syncMembers(state.people, members);
    }
  }
  private async syncMembers(people: People, members: string[]) {
    try {
      const desired = new Set(people.map((person) => person.webId));
      for (const member of members)
        if (!desired.has(member)) await this.options.syncMembers(member, false);
      for (const member of desired)
        if (!members.includes(member)) await this.options.syncMembers(member, true);
    } catch {
      throw new ShareError("members-sync");
    }
  }
  setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: { expires?: Date; purpose?: string },
  ): Promise<void> {
    return this.enqueue(async () => {
      this.validate(url);
      if (
        safeHttpIri(webId) !== webId ||
        (role !== null && role !== "viewer" && role !== "editor") ||
        opts?.expires ||
        opts?.purpose
      )
        throw new ShareError("unsupported");
      const signal = new AbortController().signal;
      // Reading for a change must not widen the folder before its narrowing step.
      const before = await this.readState(url, signal, "none");
      if (!before.canManage || before.readOnly) throw new ShareError("forbidden");
      if (before.people.some((person) => person.webId === webId && person.role === "owner"))
        throw new ShareError("forbidden");
      const next = before.people.filter((person) => person.webId !== webId);
      if (role) next.push({ webId, role });
      const folderUrl = this.options.folderUrl;
      const folder = await this.acl(folderUrl, signal);
      if (!folder && !(await this.options.ensurePrivate(folderUrl, this.options.webId)))
        throw new ShareError("unsupported");
      const existing = this.folderState(folder);
      this.requireFolderControl(existing, before);
      // Intersect *all* principals so a pre-existing mismatch cannot survive a failed tracker write.
      const lower = this.intersect(before.people, existing.people, next);
      const pending = this.unconfirmedChange;
      this.unconfirmedChange = true;
      try {
        await this.io.write(
          `${folderUrl}.acl`,
          folder
            ? preserveGroupWac(policy(folderUrl, lower), folder.dataset)
            : policy(folderUrl, lower),
          folder ? { etag: folder.etag } : { create: true },
        );
        const trackerAcl = (await this.acl(url, signal))?.etag;
        await this.tracker.setPerson(url, webId, role, opts);
        // Only a committed tracker write proves an earlier lost write can no longer land (its
        // If-Match is now stale). After a no-op, keep narrowing until a real write confirms.
        const settled = !pending || (await this.acl(url, signal))?.etag !== trackerAcl;
        const confirmed = await this.readState(url, signal, settled ? "all" : "narrow", settled);
        if (!confirmed.canManage || confirmed.readOnly) throw new ShareError("forbidden");
        if (settled) this.unconfirmedChange = false;
      } catch (error) {
        // A lost tracker response may still have committed. Re-read before syncing members;
        // leave any failed recovery for the next load, while preserving the original error.
        await this.readState(url, signal, "narrow").catch(() => undefined);
        throw error;
      }
    });
  }
  async setGeneral(): Promise<void> {
    throw new ShareError("unsupported");
  }
  private error(error: unknown): ShareError {
    if (error instanceof ShareError) return error;
    if (error instanceof SharingError) return new ShareError("unsupported");
    if (error instanceof ModelError)
      return new ShareError(
        error.status === 412 ? "conflict" : error.status === 403 ? "forbidden" : "network",
      );
    return new ShareError(error instanceof TypeError ? "unsupported" : "network");
  }
}
