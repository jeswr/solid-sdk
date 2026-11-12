// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import {
  createNotify,
  type NotifyActivity,
  type NotifyResult,
  shareNotification,
} from "@jeswr/pod-access/notify";
import {
  addGrant,
  isGrantableTarget,
  readAccessModes,
  removeGrant,
  type SetGrantsResult,
  setGrants,
} from "@jeswr/pod-access/roles";
import {
  buildGroup,
  ContactGroup,
  parseGroup,
  serializeGroup,
} from "@jeswr/solid-task-model/contacts";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { DataFactory } from "n3";
import { ownerOnlyAccess, publicReadModes } from "./owner-access.js";
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
  private async provision(url: string, publicRead: boolean) {
    await this.ensureContainer(url);
    const snapshot = await readAccessModes(url, this.options(url));
    if (publicRead && !publicReadModes(snapshot, this.session.webId)) {
      for await (const _entry of this.session.storage.listAll(url)) throw new Error(GROUP_UNSAFE);
    }
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
        { ...this.options(url), expected: { [url]: snapshot.version }, ownOnly: true },
      ),
    );
  }
  /** Raw modes, so principals that map to no role (e.g. Append only) are never hidden. */
  private async assertPublicRead(url: string) {
    if (!publicReadModes(await readAccessModes(url, this.options(url)), this.session.webId))
      throw new Error(GROUP_UNSAFE);
  }
  /** The groups folder (who may add documents, and what they inherit) and the document itself. */
  private async assertShareable(id: string) {
    const url = this.document(id);
    await this.assertPublicRead(this.container);
    await this.assertPublicRead(url);
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
      const data: unknown = JSON.parse(await read.text());
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
      if (!(await ownerOnlyAccess(this.session, this.settingsUrl)))
        throw new Error("Group settings must be owner-only before they can be used");
      return { data: data as Settings, etag: etag(read.etag) };
    } catch (error) {
      if (!missing(error)) throw error;
      return { data: { notices: [], spaces: {} }, etag: null };
    }
  }
  private async updateSettings(change: (settings: Settings) => void) {
    await this.provision(this.settingsContainer, false);
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
    try {
      await this.session.storage.head(this.container);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    for await (const entry of this.session.storage.listAll(this.container)) {
      if (entry.kind !== "resource" || !entry.url.endsWith(".ttl")) continue;
      if (groups.length >= 500) throw new Error("Too many groups to list safely");
      const id = `${entry.url}#this`;
      // An empty, not yet provisioned folder lists nothing; any group needs a safe folder.
      if (!groups.length) await this.assertPublicRead(this.container);
      await this.assertPublicRead(this.document(id));
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
      await this.provision(this.container, true);
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
