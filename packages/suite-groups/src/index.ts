// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import {
  createNotify,
  type NotifyActivity,
  type NotifyResult,
  shareNotification,
} from "@jeswr/pod-access/notify";
import {
  type AccessModesSnapshot,
  addGrant,
  isGrantableTarget,
  isSealed,
  isSecuring,
  readAccessModes,
  readGrants,
  removeGrant,
  type SetGrantsResult,
  sealAccess,
  setGrants,
  unsealAccess,
} from "@jeswr/pod-access/roles";
import {
  buildGroup,
  ContactGroup,
  parseGroup,
  serializeGroup,
} from "@jeswr/solid-task-model/contacts";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { DataFactory } from "n3";
import { ownerOnlyModes, publicReadModes } from "./owner-access.js";
import { wacGroupIds } from "./wac.js";

export interface SharedGroup {
  id: string;
  name: string;
  members: string[];
  family: boolean;
}
export interface GroupSession {
  storage: StorageClient;
  fetch: typeof globalThis.fetch;
  webId: string;
}
interface Settings {
  family?: string;
  notices: string[];
  spaces: Record<string, string[]>;
}
export interface FamilySpace {
  key: string;
  create(): Promise<string[]>;
  role: "viewer" | "editor";
}
/** A dedicated folder of the directory: shareable groups, or the private settings. */
export type GroupFolder = "groups" | "settings";
/**
 * What an unverified document says, read for the owner to decide with and trusted for nothing
 * else: a group's name and member WebIDs, or the settings' Family group and the space URLs they
 * would grant it. `unreadable` when it can't be read or parsed (it can then only be removed).
 * `inherits` says whether it inherits its folder's access; one with its own access document can
 * only be removed.
 */
export type UnverifiedContent = { url: string; inherits: boolean } & (
  | { kind: "group"; name: string; members: string[] }
  | { kind: "settings"; family: string | null; spaces: string[] }
  | { kind: "unreadable" }
);
/**
 * A safe folder holding documents written while it was not sealed (by an earlier build, an
 * external ACL editor that dropped the seal, or a cleanup that never finished). They are never
 * trusted or deleted until the owner decides with `verifyFolder`.
 *
 * `planted` folders were being secured from access others held when that pass stopped (a failed
 * delete, a crash): their documents were added by others while it ran, so they are never kept.
 * The next provisioning pass removes them, as does `verifyFolder(folder, "discard")`.
 * `keepable` is whether "keep" may be offered: the folder is not `planted`, and every document is
 * previewed in `contents` (at most `PREVIEW_LIMIT`), readable, and inherits the folder's access.
 */
export interface UnverifiedFolder {
  folder: GroupFolder;
  documents: string[];
  contents: UnverifiedContent[];
  planted: boolean;
  keepable: boolean;
}
export interface DeletionReview {
  group: string;
  resources: string[];
}
export const GROUP_PRIVACY =
  "Shareable group names and member WebIDs are publicly readable so your Solid server can check group access. Private contact labels stay private.";
export const GROUP_UNSUPPORTED =
  "Group sharing is available on WAC pods only. ACP and other access systems do not support groups here yet.";
export const GROUP_TARGET =
  "Groups can't be given access to your whole pod, your settings or the groups folder. Choose a specific item.";
/** Delivery receipts kept in the private settings: the newest, oldest dropped first. */
export const NOTICE_LIMIT = 2000;
/** Unverified documents read for the owner's preview, per folder. */
export const PREVIEW_LIMIT = 500;
export const SETTINGS_UNSAFE = "Group settings must be owner-only before they can be used";
export const SECURING_RACE =
  "Something was added while this folder was being secured. Because others could write it, it was removed or will be ignored. Reload and try again";
export const SECURING_BLOCKED =
  "Something added while this folder was being secured could not be removed, so the folder can't be trusted. Remove it, then try again";
export const GROUPS_UNVERIFIED =
  "Some group files were changed outside the suite. Keep them or remove them in Settings → Groups & family to continue";
export const SETTINGS_UNVERIFIED =
  "Group settings were changed outside the suite. Keep them or remove them in Settings → Groups & family to continue";
export const SECURING_INTERRUPTED =
  "These files were added by someone else while this folder was being secured, so they can't be kept. Remove them to continue";
export const UNVERIFIED_UNREADABLE =
  "A file in this folder can't be read, so it can't be kept. Remove it to continue";
export const GROUP_UNSAFE =
  "Shareable groups need public Read and owner-only changes. Private contact labels won't be published. Review this groups folder's access before continuing.";

export function memberWebId(value: string): string {
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== value ||
    /[\s<>"{}|^`\\]/.test(value)
  )
    throw new TypeError("Enter a valid HTTP(S) WebID");
  return value;
}
function nameOf(value: string) {
  const name = value.trim();
  if (!name || name.length > 160) throw new TypeError("Use a group name of 1–160 characters");
  return name;
}
function missing(error: unknown) {
  return error instanceof StorageError && error.code === "not-found";
}
const auxiliary = (url: string) => /\.(acl|acr|meta)$/.test(url);
type Verdict = (snapshot: AccessModesSnapshot, webId: string) => boolean;
function check(result: SetGrantsResult) {
  if (result.failed.length) throw result.failed[0]?.error;
}
/** A receipt key `[group, member, target]`; anything else matches no group or member. */
function receipt(key: string): unknown[] {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
/**
 * The private settings document's shape, checked before any use. Who wrote it is checked
 * separately (`settings`); the owner's preview of unverified settings reads it through this
 * parser and trusts it for nothing else.
 */
function parseSettings(text: string): Settings {
  const data: unknown = JSON.parse(text);
  if (
    !data ||
    typeof data !== "object" ||
    !("notices" in data) ||
    !Array.isArray(data.notices) ||
    !data.notices.every((v) => typeof v === "string") ||
    !("spaces" in data) ||
    !data.spaces ||
    typeof data.spaces !== "object" ||
    Object.values(data.spaces).some(
      (v) => !Array.isArray(v) || !v.every((u) => typeof u === "string"),
    ) ||
    ("family" in data && typeof data.family !== "string")
  )
    throw new Error("Group settings are unreadable");
  return data as Settings;
}
function etag(value: string | null) {
  if (!value || !/^"[^"\r\n]*"$/.test(value))
    throw new Error("Reload before changing groups: a strong ETag is required");
  return value;
}

/** Domain RDF is the existing ContactGroup model; Family/receipt metadata is private JSON. */
export class GroupDirectory {
  readonly container: string;
  private readonly settingsContainer: string;
  private readonly settingsUrl: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly notify: (webId: string, activity: NotifyActivity) => Promise<NotifyResult>;
  constructor(
    private readonly session: GroupSession,
    notify?: (webId: string, activity: NotifyActivity) => Promise<NotifyResult>,
  ) {
    const feature = session.storage.features.accessControl;
    if (
      session.storage.protocol !== "solid" ||
      feature.state !== "available" ||
      feature.detail.model !== "wac"
    )
      throw new Error(GROUP_UNSUPPORTED);
    memberWebId(session.webId);
    this.container = new URL("groups/", session.storage.root).href;
    this.settingsContainer = new URL("settings/group-sharing/", session.storage.root).href;
    this.settingsUrl = new URL("state.json", this.settingsContainer).href;
    this.notify = notify ?? createNotify({ fetch: session.fetch });
  }
  private options(url: string) {
    return {
      fetch: this.session.fetch,
      webId: this.session.webId,
      root: this.session.storage.root,
      model: "wac" as const,
      kind: url.endsWith("/") ? ("folder" as const) : ("resource" as const),
    };
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(action);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private document(id: string) {
    const url = new URL(id);
    if (
      url.hash !== "#this" ||
      url.search ||
      new URL(".", url).href !== this.container ||
      !/\/[a-zA-Z0-9-]+\.ttl$/.test(url.pathname)
    )
      throw new Error("Choose a shareable group in your pod");
    url.hash = "";
    return url.href;
  }
  private async ensureContainer(url: string) {
    try {
      await this.session.storage.head(url);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = new URL("..", url).href;
      if (parent !== this.session.storage.root) await this.ensureContainer(parent);
      // Solid exact-name create is conditional. Another tab winning is safe to re-read.
      try {
        await this.session.storage.create(new URL("..", url).href, null, {
          name: url.split("/").at(-2),
          kind: "container",
        });
      } catch (cause) {
        if (!(cause instanceof StorageError && cause.code === "conflict")) throw cause;
        await this.session.storage.head(url);
      }
    }
  }
  private folder(kind: GroupFolder) {
    return kind === "groups"
      ? {
          url: this.container,
          publicRead: true,
          verdict: publicReadModes as Verdict,
          readable: (url: string) => url.endsWith(".ttl"),
          unsafe: GROUP_UNSAFE,
          unverified: GROUPS_UNVERIFIED,
        }
      : {
          url: this.settingsContainer,
          publicRead: false,
          verdict: ownerOnlyModes as Verdict,
          readable: (url: string) => url === this.settingsUrl,
          unsafe: SETTINGS_UNSAFE,
          unverified: SETTINGS_UNVERIFIED,
        };
  }
  private async exists(url: string) {
    try {
      await this.session.storage.head(url);
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  /** Direct entries that are not access or metadata documents. */
  private async entries(url: string) {
    const found: string[] = [];
    for await (const entry of this.session.storage.listAll(url))
      if (!auxiliary(entry.url)) found.push(entry.url);
    return found;
  }
  /**
   * Owner management (plus public Read for groups) in the folder's own access document. With
   * `securing`, the same write marks the folder as being secured (pod-access `isSecuring`) until
   * it is sealed: whatever it then holds was added by others, and is never kept.
   */
  private async rewrite(
    url: string,
    publicRead: boolean,
    version: AccessModesSnapshot["version"],
    securing: boolean,
  ) {
    check(
      await setGrants(
        [url],
        [
          {
            agent: { type: "webid", id: this.session.webId },
            role: "manager",
            source: "",
            inherited: false,
          },
          ...(publicRead
            ? [
                {
                  agent: { type: "public" as const },
                  role: "viewer" as const,
                  source: "",
                  inherited: false,
                },
              ]
            : []),
        ],
        { ...this.options(url), expected: { [url]: version }, ownOnly: true, securing },
      ),
    );
  }
  /**
   * Make a dedicated folder owner-managed (and publicly readable for groups), then seal it. The
   * seal, in the folder's own access document, is what readers trust: only the holder of Control
   * can write it, and it is written last, after the folder is owner-managed and holds nothing
   * that a reader would read. So a cleanup that fails, or a tab that closes, before the seal
   * leaves the folder untrusted.
   *
   * A sealed folder that is still safe is left as it is. A sealed folder whose access widened is
   * unsealed first. A folder that is not safe must be empty, since anything in it could have been
   * written by someone else. A safe but unsealed folder holding readable documents is refused
   * (`*_UNVERIFIED`) and nothing is deleted: only the owner can decide, with `verifyFolder`. Only
   * what appears between that check and the permission rewrite (this pass's race) is deleted.
   *
   * Securing an unsafe folder marks it, in the same rewrite, until the seal: a pass that stops
   * before sealing leaves a mark saying that whatever the folder holds was added by others, so
   * the next pass deletes it instead of offering it to the owner to keep.
   */
  private async provision(kind: GroupFolder): Promise<void> {
    const { url, publicRead, verdict, readable, unsafe, unverified } = this.folder(kind);
    await this.ensureContainer(url);
    const options = this.options(url);
    let snapshot = await readAccessModes(url, options);
    const safe = verdict(snapshot, this.session.webId);
    if (await isSealed(url, options)) {
      if (safe) return;
      await unsealAccess(url, options);
      snapshot = await readAccessModes(url, options);
    }
    const before = await this.entries(url);
    if (!safe && before.length) throw new Error(unsafe);
    // An earlier pass was securing this folder from unsafe access, empty, and stopped before the
    // seal: everything in it now was added while others could still write it.
    const resumed = safe && (await isSecuring(url, options));
    if (!resumed && before.some(readable)) throw new Error(unverified);
    // Rewritten even when already safe, so the folder has its own document to carry the seal.
    if (!resumed) await this.rewrite(url, publicRead, snapshot.version, !safe);
    // Leftovers that were there before (never readable, see above) are left alone.
    const planted = resumed
      ? before
      : (await this.entries(url)).filter((entry) => !before.includes(entry));
    if (await this.discard(url, planted, readable)) return this.assertFolder(kind);
    await sealAccess(url, options);
    if (planted.length) throw new Error(SECURING_RACE);
  }
  /**
   * Delete `entries`, the documents a reader would read first, carrying on past failures: an
   * entry that can't be deleted (one with its own access document that shuts the owner out, say)
   * never stops the rest. Only readable documents left in the folder block the seal; any other
   * leftover is never read.
   *
   * Returns true, deleting nothing, when another pass (another tab) has sealed the folder since
   * it was rewritten. That pass verified the folder before sealing it and creates documents only
   * after its seal, while `entries` were listed before this check: deleting them now could remove
   * a group it has just created. The caller re-checks the folder instead.
   */
  private async discard(
    url: string,
    entries: string[],
    readable: (url: string) => boolean,
  ): Promise<boolean> {
    if (entries.length && (await isSealed(url, this.options(url)))) return true;
    const ordered = [...entries].sort((a, b) => Number(readable(b)) - Number(readable(a)));
    for (const entry of ordered)
      try {
        // Conditional on what is there now; an entry without a validator stays.
        const { etag } = await this.session.storage.head(entry);
        if (etag) await this.session.storage.delete(entry, { ifMatch: etag });
      } catch {
        // Checked below for readable documents; anything else that stays is never read.
      }
    if ((await this.entries(url)).some(readable)) throw new Error(SECURING_BLOCKED);
    return false;
  }
  /**
   * What an unverified document says, for the owner's decision only: read with the same parsers
   * as the readers, but nothing is trusted, granted or written because of it.
   */
  private async preview(kind: GroupFolder, url: string): Promise<UnverifiedContent> {
    const { url: folder, verdict } = this.folder(kind);
    // A document whose access can't be read (one that shuts the owner out, say) never inherits.
    const inherits = await this.inherits(url, folder, verdict).catch(() => false);
    try {
      if (kind === "settings") {
        const data = parseSettings(await (await this.session.storage.read(url)).text());
        return {
          url,
          inherits,
          kind,
          family: data.family ?? null,
          spaces: [...new Set(Object.values(data.spaces).flat())].sort(),
        };
      }
      const data = parseGroup(url, (await this.session.storage.readRdf(url)).dataset);
      if (data)
        return {
          url,
          inherits,
          kind: "group",
          name: data.name,
          members: (data.members ?? []).map(memberWebId),
        };
    } catch {
      // Shown as unreadable, which can only be removed.
    }
    return { url, inherits, kind: "unreadable" };
  }
  /**
   * Safe folders holding documents written while they were unsealed, for the owner to keep or
   * remove with `verifyFolder`, with a preview of each document (see `UnverifiedFolder`). A
   * missing, sealed or unsafe folder is not listed. Reading has no side effects.
   */
  async unverified(): Promise<UnverifiedFolder[]> {
    const found: UnverifiedFolder[] = [];
    for (const kind of ["groups", "settings"] as const) {
      const { url, verdict, readable } = this.folder(kind);
      if (!(await this.exists(url))) continue;
      const options = this.options(url);
      if (
        !verdict(await readAccessModes(url, options), this.session.webId) ||
        (await isSealed(url, options))
      )
        continue;
      const documents = (await this.entries(url)).filter(readable).sort();
      if (!documents.length) continue;
      const planted = await isSecuring(url, options);
      const contents: UnverifiedContent[] = [];
      for (const document of documents.slice(0, PREVIEW_LIMIT))
        contents.push(await this.preview(kind, document));
      found.push({
        folder: kind,
        documents,
        contents,
        planted,
        keepable:
          !planted &&
          contents.length === documents.length &&
          contents.every((content) => content.inherits && content.kind !== "unreadable"),
      });
    }
    return found;
  }
  /**
   * The owner's decision on an unverified folder. "keep" trusts its documents as they are: the
   * folder must be safe, not `planted` (`SECURING_INTERRUPTED`), and every document must inherit
   * its access (a document with its own access document is refused, never kept) and be readable
   * (`UNVERIFIED_UNREADABLE`). "discard" deletes what the folder holds. Either way the folder is
   * then made owner-managed and sealed. A sealed, safe folder is left as it is.
   */
  verifyFolder(kind: GroupFolder, decision: "keep" | "discard") {
    const { url, publicRead, verdict, readable, unsafe } = this.folder(kind);
    return this.serial(async () => {
      if (decision !== "keep" && decision !== "discard") throw new Error("Choose keep or discard");
      if (!(await this.exists(url))) return;
      const options = this.options(url);
      const snapshot = await readAccessModes(url, options);
      if (!verdict(snapshot, this.session.webId)) throw new Error(unsafe);
      if (await isSealed(url, options)) return;
      // Added by others while a pass was securing the folder: never trusted, whatever it says.
      if (decision === "keep" && (await isSecuring(url, options)))
        throw new Error(SECURING_INTERRUPTED);
      await this.rewrite(url, publicRead, snapshot.version, false);
      const entries = await this.entries(url);
      if (decision === "discard") {
        if (await this.discard(url, entries, readable)) return this.assertFolder(kind);
      } else
        for (const entry of entries.filter(readable)) {
          const content = await this.preview(kind, entry);
          if (!content.inherits) throw new Error(unsafe);
          if (content.kind === "unreadable") throw new Error(UNVERIFIED_UNREADABLE);
        }
      await sealAccess(url, options);
    });
  }
  /** A dedicated folder is trusted only while it is sealed and its access is still safe. */
  private async assertFolder(kind: GroupFolder) {
    const { url, verdict, unsafe, unverified } = this.folder(kind);
    const options = this.options(url);
    if (!verdict(await readAccessModes(url, options), this.session.webId)) throw new Error(unsafe);
    if (!(await isSealed(url, options))) throw new Error(unverified);
  }
  /**
   * A document in a sealed folder is trusted only while it inherits the folder's access: its own
   * access document could have been planted (and sealed by its writer) before the folder was
   * secured. Raw modes, so principals that map to no role (e.g. Append only) are never hidden.
   */
  private async inherits(document: string, folder: string, verdict: Verdict) {
    const snapshot = await readAccessModes(document, this.options(document));
    return snapshot.governedBy === folder && verdict(snapshot, this.session.webId);
  }
  /** The groups folder (who may add documents, and what they inherit) and the document itself. */
  private async assertShareable(id: string) {
    const url = this.document(id);
    await this.assertFolder("groups");
    if (!(await this.inherits(url, this.container, publicReadModes))) throw new Error(GROUP_UNSAFE);
  }
  /** Storage root, settings and the groups folder are never group targets. */
  private target(url: string) {
    if (!isGrantableTarget(url, this.session.storage.root, ["groups"]))
      throw new Error(GROUP_TARGET);
    return url;
  }
  private async settings(): Promise<{ data: Settings; etag: string | null }> {
    try {
      const read = await this.session.storage.read(this.settingsUrl);
      const data = parseSettings(await read.text());
      // Trust needs the folder sealed (verified empty when it was secured) and owner-only, and
      // the document inheriting it: who could create, replace or delete it, and who wrote it.
      await this.assertFolder("settings");
      if (!(await this.inherits(this.settingsUrl, this.settingsContainer, ownerOnlyModes)))
        throw new Error(SETTINGS_UNSAFE);
      return { data, etag: etag(read.etag) };
    } catch (error) {
      if (!missing(error)) throw error;
      return { data: { notices: [], spaces: {} }, etag: null };
    }
  }
  private async updateSettings(change: (settings: Settings) => void) {
    // Provisioning never trusts what an unsealed folder holds: it refuses one that isn't empty,
    // and deletes only what appears while it secures an empty one, before sealing it.
    await this.provision("settings");
    const current = await this.settings();
    change(current.data);
    const body = JSON.stringify(current.data);
    if (current.etag)
      await this.session.storage.write(this.settingsUrl, body, {
        contentType: "application/json",
        ifMatch: current.etag,
      });
    else
      await this.session.storage.create(this.settingsContainer, body, {
        name: "state.json",
        contentType: "application/json",
      });
    return current.data;
  }
  async list(): Promise<SharedGroup[]> {
    const settings = await this.settings();
    const groups: SharedGroup[] = [];
    if (!(await this.exists(this.container))) return [];
    for await (const entry of this.session.storage.listAll(this.container)) {
      if (entry.kind !== "resource" || !entry.url.endsWith(".ttl")) continue;
      if (groups.length >= 500) throw new Error("Too many groups to list safely");
      const id = `${entry.url}#this`;
      // An empty, not yet provisioned folder lists nothing; any group needs a sealed, safe folder.
      if (!groups.length) await this.assertFolder("groups");
      if (!(await this.inherits(this.document(id), this.container, publicReadModes)))
        throw new Error(GROUP_UNSAFE);
      const read = await this.session.storage.readRdf(entry.url);
      const data = parseGroup(entry.url, read.dataset);
      if (!data) throw new Error("A shareable group is unreadable");
      groups.push({
        id,
        name: data.name,
        members: (data.members ?? []).map(memberWebId),
        family: settings.data.family === id,
      });
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }
  create(name: string, members: readonly string[] = []) {
    const label = nameOf(name);
    const ids = [...new Set(members.map(memberWebId))];
    return this.serial(async () => {
      await this.provision("groups");
      const filename = `${crypto.randomUUID()}.ttl`;
      const doc = new URL(filename, this.container).href;
      const created = await this.session.storage.create(
        this.container,
        await serializeGroup(doc, { name: label, members: ids }),
        { name: filename, contentType: "text/turtle" },
      );
      await this.assertShareable(`${created.url}#this`);
      return { id: `${created.url}#this`, name: label, members: ids, family: false };
    });
  }
  private edit(id: string, change: (group: ContactGroup) => void, after?: () => Promise<void>) {
    const url = this.document(id);
    return this.serial(async () => {
      await this.assertShareable(id);
      const current = await this.session.storage.readRdf(url);
      if (!parseGroup(url, current.dataset)) throw new Error("Group is unreadable");
      // ContactGroup keeps unrelated RDF and all edits use the document's observed validator.
      const group = new ContactGroup(id, current.dataset, DataFactory);
      change(group);
      await this.session.storage.writeRdf(url, current.dataset, { ifMatch: etag(current.etag) });
      await after?.();
    });
  }
  /** Drop matching receipts; settings that do not exist yet are not created for this. */
  private async prune(match: (key: unknown[]) => boolean) {
    const current = await this.settings();
    if (!current.etag || !current.data.notices.some((key) => match(receipt(key)))) return;
    await this.updateSettings((data) => {
      data.notices = data.notices.filter((key) => !match(receipt(key)));
    });
  }
  rename(id: string, name: string) {
    const label = nameOf(name);
    return this.edit(id, (group) => {
      group.name = label;
    });
  }
  addMember(id: string, webId: string) {
    const member = memberWebId(webId);
    return this.edit(id, (group) => {
      group.members.add(member);
    });
  }
  removeMember(id: string, webId: string) {
    const member = memberWebId(webId);
    // A removed member's receipts go too: re-adding them later invites them again.
    return this.edit(
      id,
      (group) => {
        group.members.delete(member);
      },
      () => this.prune(([group, person]) => group === id && person === member),
    );
  }
  setFamily(id: string) {
    this.document(id);
    return this.serial(async () => {
      await this.assertShareable(id);
      const current = await this.session.storage.readRdf(this.document(id));
      if (!parseGroup(this.document(id), current.dataset)) throw new Error("Group is unreadable");
      await this.updateSettings((data) => {
        data.family = id;
      });
    });
  }
  async grants(id: string): Promise<DeletionReview> {
    this.document(id);
    const pending = [this.session.storage.root];
    const visited = new Set<string>();
    const resources: string[] = [];
    while (pending.length) {
      const url = pending.shift() as string;
      if (visited.has(url)) continue;
      if (!this.session.storage.isWithinStorage(url) || visited.size >= 2000)
        throw new Error("The grants scan is incomplete; group deletion is blocked");
      visited.add(url);
      const head = await this.session.storage.head(url);
      const links = head.links.get("acl") ?? [];
      const source = links[0]?.target;
      if (links.length !== 1 || !source || !this.session.storage.isWithinStorage(source))
        throw new Error("The grants scan is incomplete: no readable WAC document");
      try {
        const document = await this.session.storage.readRdf(source);
        if (
          [...document.dataset].some(
            (quad) =>
              quad.graph.termType !== "DefaultGraph" ||
              quad.predicate.value.startsWith("http://www.w3.org/ns/solid/acp#"),
          )
        )
          throw new Error("Unsupported access document in grants scan");
        if (wacGroupIds(document.dataset, url, source).includes(id)) resources.push(url);
      } catch (error) {
        // Missing own ACLs inherit from an ancestor, which the complete walk checks separately.
        if (!missing(error)) throw error;
      }
      if (url.endsWith("/"))
        for await (const entry of this.session.storage.listAll(url)) {
          if (!/\.(acl|acr|meta)$/.test(entry.url)) pending.push(entry.url);
        }
    }
    return { group: id, resources: resources.sort() };
  }
  delete(review: DeletionReview) {
    const id = review.group;
    const url = this.document(id);
    const approved = [...review.resources].sort();
    return this.serial(async () => {
      const current = await this.grants(id);
      if (JSON.stringify(current.resources) !== JSON.stringify(approved))
        throw new Error("Group grants changed. Review them again before deleting");
      const group = await this.session.storage.readRdf(url);
      const validator = etag(group.etag);
      for (const resource of current.resources)
        check(await removeGrant([resource], { type: "group", id }, this.options(resource)));
      await this.session.storage.delete(url, { ifMatch: validator });
      await this.updateSettings((data) => {
        if (data.family === id) delete data.family;
        data.notices = data.notices.filter((key) => receipt(key)[0] !== id);
      });
    });
  }
  /** One delivery attempt per member/target, claimed durably before posting. Never re-send on a retry. */
  notifyOnce(id: string, target: string, summary: string) {
    this.document(id);
    return this.serial(async () => {
      const group = (await this.list()).find((group) => group.id === id);
      if (!group) throw new Error("Group not found");
      const results: NotifyResult[] = [];
      for (const member of group.members.filter((member) => member !== this.session.webId)) {
        const key = JSON.stringify([id, member, target]);
        let send = false;
        await this.updateSettings((data) => {
          if (!data.notices.includes(key)) {
            data.notices.push(key);
            data.notices.splice(0, Math.max(0, data.notices.length - NOTICE_LIMIT));
            send = true;
          }
        });
        if (send)
          results.push(
            await this.notify(member, {
              type: "Announce",
              actor: this.session.webId,
              object: target,
              summary,
            }),
          );
      }
      return results;
    });
  }
  async share(id: string, resource: string | readonly string[], role: "viewer" | "editor") {
    this.document(id);
    if (role !== "viewer" && role !== "editor")
      throw new Error("Groups can be given Viewer or Editor access only");
    const resources = typeof resource === "string" ? [resource] : [...new Set(resource)];
    const target = resources[0];
    if (!target) throw new Error("Choose a resource to share");
    for (const url of resources) this.target(url);
    if (!(await this.list()).some((group) => group.id === id)) throw new Error("Group not found");
    for (const url of resources)
      check(
        await addGrant(
          [url],
          { agent: { type: "group", id }, role, inherited: false, source: "" },
          this.options(url),
        ),
      );
    return this.notifyOnce(id, target, shareNotification(target, role).summary as string);
  }
  /**
   * Contents follow their collection: every shareable group with access to `source` (a shared
   * album, say) gets Viewer access to `resources` (an added photo's document and binaries).
   * Returns the groups granted. It sends no notification; sharing the collection already did.
   * `within` is the application space (e.g. the Photos library) that must contain the source
   * and every resource, so a collection never extends access outside its own space.
   */
  async extend(
    source: string,
    resources: readonly string[],
    options: { within: string },
  ): Promise<string[]> {
    const space = this.target(options.within);
    if (!space.endsWith("/") || new URL(space).href !== space)
      throw new Error("Choose the application folder the collection belongs to");
    const inside = (url: string) => {
      if (new URL(url).href !== url || !url.startsWith(space) || url === space)
        throw new Error(GROUP_TARGET);
      return this.target(url);
    };
    inside(source);
    const targets = [...new Set(resources)].map(inside);
    const held = new Set(
      (await readGrants(source, this.options(source))).grants.flatMap((grant) =>
        grant.agent.type === "group" ? [grant.agent.id] : [],
      ),
    );
    if (!held.size || !targets.length) return [];
    const granted = (await this.list()).map((group) => group.id).filter((group) => held.has(group));
    for (const id of granted)
      for (const url of targets)
        check(
          await addGrant(
            [url],
            { agent: { type: "group", id }, role: "viewer", inherited: false, source: "" },
            this.options(url),
          ),
        );
    return granted;
  }
  async setupFamily(id: string, spaces: readonly FamilySpace[]) {
    if (spaces.some((space) => space.role !== "viewer" && space.role !== "editor"))
      throw new Error("Groups can be given Viewer or Editor access only");
    await this.setFamily(id);
    for (const space of spaces) {
      const key = JSON.stringify([id, space.key]);
      let urls = (await this.settings()).data.spaces[key];
      if (!urls) {
        urls = await space.create();
        // Defence in depth: a factory never hands the group the pod, settings or groups.
        const created = urls.map((url) => this.target(url));
        await this.serial(() =>
          this.updateSettings((data) => {
            data.spaces[key] = created;
          }),
        );
      }
      // Stored URLs are re-checked: settings are owner-only, but never the only safeguard.
      for (const url of urls) this.target(url);
      for (const url of urls)
        check(
          await addGrant(
            [url],
            { agent: { type: "group", id }, role: space.role, inherited: false, source: "" },
            this.options(url),
          ),
        );
    }
    return this.notifyOnce(id, id, "Invitation to your Family group");
  }
}

export { ownerOnlyAccess } from "./owner-access.js";
export { peopleWac, preserveGroupWac, wacGroupIds } from "./wac.js";
export { buildGroup, serializeGroup };
