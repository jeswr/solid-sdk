// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";
import type { Outbox, OutboxItem, ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { isomorphic } from "rdf-isomorphic";
import { z } from "zod";
import { ModelError } from "../lib/model/errors";
import { RdfIO, type Resource } from "../lib/model/io";
import { DataFactory, NS, node, parse, SCHEMA, serialize } from "../lib/model/rdf";
import { TaskStore } from "../lib/model/store";
import { createTask, TaskItem, taskDetails, validateTask } from "../lib/model/task";
import { TaskTracker } from "../lib/model/tracker";

export const TASKS_REPLAY = "tasks.intent.v1";
export const DEPENDENCY_MESSAGE = "An earlier Tasks change must sync first";
export const SKIPPED_MESSAGE = "An earlier Tasks change was not applied, so this one was held back";
const APPLIED_LIMIT = 1000;
const savedSchema = z.object({
  body: z.string(),
  etag: z.string().nullable(),
  local: z.boolean(),
  deleted: z.boolean().optional(),
});
const intentSchema = z.object({
  url: z.url(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  etag: z.string().nullable(),
  dependsOn: z.array(z.string()).default([]),
  /** Earlier changes in the same scope (a move) that must have applied, not only settled. */
  requires: z.array(z.string()).default([]),
  revision: z.string(),
});
type Saved = z.infer<typeof savedSchema>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const networkError = (error: unknown) => error instanceof TypeError;
const conflictError = (url: string, etag: string | null = null) =>
  new StorageError("precondition-failed", {
    url,
    method: "PUT",
    status: 412,
    etag,
    message: "Title, due date or completion changed elsewhere",
  });

/** A session-owned transport adapter. The shell's durable outbox owns every queued write. */
export class TasksOffline {
  private cleared = false;
  private readonly receipts = new Set<
    (url: string, local: string, remote: string | null) => void
  >();
  readonly subscribeReceipts = (
    listener: (url: string, local: string, remote: string | null) => void,
  ) => {
    this.receipts.add(listener);
    return () => {
      this.receipts.delete(listener);
    };
  };
  readonly confirm = (url: string, local: string, remote: string | null) => {
    this.validators.set(`${url}\u0000${local}`, remote);
    this.save();
    for (const listener of this.receipts) listener(url, local, remote);
  };
  readonly baseEtag = (url: string, local: string | null) =>
    this.validators.get(`${url}\u0000${local}`) ?? local;
  /** A replay settled this resource: fence listing reads that began before it. */
  readonly settled = (url: string) => {
    for (const key of [url, new URL(".", url).href])
      this.changes.set(key, (this.changes.get(key) ?? 0) + 1);
  };
  // Writes inside one scope (a project move) replay in order across resources: a source
  // delete never replays before the destination create it depends on has succeeded.
  private scope: string[] | undefined;
  readonly together = async <T>(run: () => Promise<T>): Promise<T> => {
    const outer = this.scope;
    this.scope = outer ?? [];
    try {
      return await run();
    } finally {
      this.scope = outer;
    }
  };
  // A later queued delete must compare the server generation of its own earlier
  // write, including when the app reloads between deliveries.
  private readonly validators = new Map<string, string | null>();
  // Queue entries whose own intent reached the pod. A follower may replay only after its
  // prerequisites applied: one resolved by "Keep both" or discarded leaves the original
  // reference unchanged, so a dependent source delete must not run.
  private readonly applied = new Set<string>();
  private readonly changes = new Map<string, number>();
  private readonly versions = new Map<string, Saved>();
  private readonly documents = new Map<string, Saved>();
  private readonly key: string;
  private readonly io: RdfIO;
  constructor(
    private readonly options: {
      webId: string;
      storageUrl: string;
      fetch: typeof fetch;
      online: () => boolean;
      outbox: () => Outbox | null;
      storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
      onConfirm?: (url: string, local: string, remote: string | null) => void;
      baseEtag?: (url: string, local: string | null) => string | null;
      onEnqueue?: () => void;
      onSettled?: (url: string) => void;
    },
  ) {
    this.key = `suite.tasks.cache.v1.${options.webId}\u0000${options.storageUrl}`;
    this.io = new RdfIO(options.fetch);
    try {
      const stored = z
        .object({
          webId: z.string(),
          documents: z.record(z.string(), savedSchema),
          validators: z.record(z.string(), z.string().nullable()).default({}),
          applied: z.array(z.string()).default([]),
        })
        .parse(JSON.parse(options.storage?.getItem(this.key) ?? "null"));
      if (stored.webId === options.webId) {
        for (const [url, saved] of Object.entries(stored.documents)) this.documents.set(url, saved);
        for (const [key, etag] of Object.entries(stored.validators)) this.validators.set(key, etag);
        for (const id of stored.applied) this.applied.add(id);
      }
    } catch {
      /* Missing, corrupt or unavailable cache is a miss. */
    }
  }
  private save() {
    if (this.cleared) return;
    try {
      this.options.storage?.setItem(
        this.key,
        JSON.stringify({
          webId: this.options.webId,
          documents: Object.fromEntries(this.documents),
          validators: Object.fromEntries(this.validators),
          applied: [...this.applied].slice(-APPLIED_LIMIT),
        }),
      );
    } catch {
      /* Read caching is best effort; writes are durable in the shell outbox. */
    }
  }
  clear() {
    this.cleared = true;
    this.documents.clear();
    this.versions.clear();
    this.validators.clear();
    this.applied.clear();
    this.changes.clear();
    try {
      this.options.storage?.removeItem(this.key);
    } catch {
      /* Unavailable storage. */
    }
  }
  readonly online = () => this.options.online();
  private waiting(url: string) {
    return (
      this.options
        .outbox()
        ?.pending()
        .some((item) => item.url === url) ?? false
    );
  }
  private response(url: string, saved: Saved): Response {
    if (saved.deleted) return new Response(null, { status: 404 });
    const response = new Response(saved.body, {
      headers: {
        "Content-Type": "text/turtle",
        ...(saved.etag ? { ETag: saved.etag } : {}),
      },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }
  private keepVersion(url: string, saved: Saved | undefined) {
    if (saved?.etag) this.versions.set(`${url}\u0000${saved.etag}`, saved);
    if (this.versions.size > 256) this.versions.delete(this.versions.keys().next().value as string);
  }
  private async remember(url: string, body: string | null, etag: string | null, local: boolean) {
    if (this.cleared) return;
    const parent = new URL(".", url).href;
    for (const key of [url, parent]) this.changes.set(key, (this.changes.get(key) ?? 0) + 1);
    this.keepVersion(url, this.documents.get(url));
    if (body === null) this.documents.set(url, { body: "", etag, local, deleted: true });
    else this.documents.set(url, { body, etag, local });
    const listing = this.documents.get(parent);
    if (listing) {
      const dataset = await parse(parent, listing.body);
      const members = node(parent, dataset).iris(`${NS.LDP}contains`);
      if (body === null) members.delete(url);
      else members.add(url);
      this.documents.set(parent, { ...listing, body: await serialize(dataset) });
    }
    this.save();
  }
  private async overlay(url: string, body: string): Promise<string> {
    if (!url.endsWith("/")) return body;
    const dataset = await parse(url, body);
    const members = node(url, dataset).iris(`${NS.LDP}contains`);
    for (const item of this.options.outbox()?.pending() ?? []) {
      if (item.guard?.tag !== TASKS_REPLAY || new URL(".", item.url).href !== url) continue;
      if (item.op === "create") members.add(item.url);
      if (item.op === "delete") members.delete(item.url);
    }
    return serialize(dataset);
  }
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.cleared) throw new Error("The Tasks account is no longer active");
    const url = String(input);
    const method = init?.method ?? "GET";
    const outbox = this.options.outbox();
    const cached = this.documents.get(url);
    if (method === "GET") {
      const generation = this.changes.get(url);
      const newer = () => {
        if (generation === this.changes.get(url)) return null;
        const saved = this.documents.get(url);
        return saved ? this.response(url, saved) : this.fetch(input, init);
      };
      if (cached && (!this.options.online() || (cached.local && this.waiting(url))))
        return this.response(url, cached);
      if (!this.options.online()) {
        const listing = this.documents.get(new URL(".", url).href);
        if (
          listing &&
          !node(new URL(".", url).href, await parse(new URL(".", url).href, listing.body))
            .iris(`${NS.LDP}contains`)
            .has(url)
        )
          return new Response(null, { status: 404 });
        throw new TypeError("Not available offline");
      }
      try {
        const response = await this.options.fetch(input, init);
        const latest = newer();
        if (latest) return latest;
        if (
          response.ok &&
          (!response.url || response.url === url) &&
          response.headers.get("Content-Type")?.includes("turtle")
        ) {
          const saved = {
            body: await this.overlay(url, await response.clone().text()),
            etag: response.headers.get("ETag"),
            local: false,
          };
          const latest = newer();
          if (latest) return latest;
          this.keepVersion(url, cached);
          this.documents.set(url, saved);
          this.save();
          return this.response(url, saved);
        } else if ([401, 403, 404, 410].includes(response.status)) {
          this.documents.delete(url);
          this.save();
        }
        return response;
      } catch (error) {
        const latest = newer();
        if (latest) return latest;
        if (cached && networkError(error)) return this.response(url, cached);
        throw error;
      }
    }
    if (!outbox || !["PUT", "DELETE"].includes(method)) return this.options.fetch(input, init);
    const after = method === "PUT" ? String(init?.body ?? "") : null;
    const dataset =
      after === null ? (cached ? await parse(url, cached.body) : null) : await parse(url, after);
    const task = dataset ? new TaskItem(`${url}#it`, dataset, DataFactory) : null;
    const tracker = dataset ? new TaskTracker(`${url}#this`, dataset, DataFactory) : null;
    if (!task?.isTask && !tracker?.isTracker) return this.options.fetch(input, init);
    const headers = new Headers(init?.headers);
    const creating = headers.get("If-None-Match") === "*";
    // Once a write in this scope is queued, later writes in it queue behind it.
    if (this.options.online() && !this.waiting(url) && !this.scope?.length) {
      try {
        const response = await this.options.fetch(input, init);
        if (response.ok) await this.remember(url, after, response.headers.get("ETag"), false);
        return response;
      } catch (error) {
        if (!networkError(error) || init?.signal?.aborted) throw error;
      }
    }
    const base =
      cached?.etag === headers.get("If-Match")
        ? cached
        : this.versions.get(`${url}\u0000${headers.get("If-Match")}`);
    if (!creating && !base) throw new Error("Not available offline");
    const intent = {
      url,
      revision: crypto.randomUUID(),
      before: creating ? null : (base?.body ?? null),
      after,
      etag: headers.get("If-Match"),
      dependsOn: outbox
        .pending()
        .filter((item) => item.guard?.tag === TASKS_REPLAY && item.url === url)
        .slice(-1)
        .map((item) => item.id)
        .concat(this.scope ?? []),
      requires: [...(this.scope ?? [])],
    };
    const queued = await outbox.enqueue({
      op: creating ? "create" : method === "DELETE" ? "delete" : "write",
      url,
      ...(creating
        ? {
            container: new URL(".", url).href,
            name: url.split("/").pop() as string,
            createOptions: {
              name: url.split("/").pop() as string,
              contentType: "application/json",
            },
          }
        : {}),
      body: JSON.stringify(intent),
      contentType: "application/json",
      ...(intent.etag ? { ifMatch: intent.etag } : {}),
      label: task?.isTask ? (task.title ?? "Task") : (tracker?.title ?? "Project"),
      guard: { tag: TASKS_REPLAY, assertions: { url } },
    });
    const etag = `"tasks-offline-${intent.revision}"`;
    await this.remember(url, after, etag, true);
    this.scope?.push(queued.id);
    this.options.onEnqueue?.();
    return new Response(null, { status: 204, headers: { ETag: etag } });
  };

  async conflictSummary(id: string): Promise<string> {
    const body = await this.options.outbox()?.localBody(id);
    const intent = intentSchema.parse(
      JSON.parse(new TextDecoder().decode(body ?? new Uint8Array())),
    );
    const current = await this.io.read(intent.url);
    const before =
      intent.before === null
        ? null
        : taskDetails(intent.url, await parse(intent.url, intent.before));
    const after = taskDetails(intent.url, current.dataset);
    if (!before || !after) return "Title changed elsewhere";
    const changed = [
      !equal(before.title, after.title) ? "Title" : "",
      !equal(before.dueDate, after.dueDate) || !equal(before.allDay, after.allDay)
        ? "Due date"
        : "",
      before.state !== after.state ? "Completion" : "",
    ].filter(Boolean);
    return changed.length
      ? `${changed.join(", ")} changed elsewhere`
      : "This task changed elsewhere";
  }

  /** Changes that failed only because an earlier one had not synced get another try. */
  private resumeFollowers() {
    const outbox = this.options.outbox();
    for (const item of outbox?.pending() ?? [])
      if (
        item.guard?.tag === TASKS_REPLAY &&
        item.status === "failed" &&
        item.error?.includes(DEPENDENCY_MESSAGE)
      )
        // Not awaited: the outbox serialises this retry after the active replay.
        void outbox?.retry(item.id).catch(() => {});
  }
  /** Every update is re-applied through typed accessors to a newly read document. */
  private async entryId(delivery: Parameters<ReplayDelegate>[0]): Promise<string | undefined> {
    const outbox = this.options.outbox();
    for (const item of outbox?.pending() ?? []) {
      if (item.url !== delivery.url || item.guard?.tag !== TASKS_REPLAY) continue;
      const body = await outbox?.localBody(item.id);
      if (body && equal([...body], [...(delivery.body ?? [])])) return item.id;
    }
    return undefined;
  }
  readonly replay: ReplayDelegate = async (delivery, ctx) => {
    try {
      // "Keep both" copies the change elsewhere, so the queued intent itself never applies.
      const id = delivery.purpose === "resolve-both" ? undefined : await this.entryId(delivery);
      const result = await this.deliver(delivery, ctx);
      if (id) {
        this.applied.add(id);
        this.save();
      }
      (this.options.onSettled ?? this.settled)(delivery.url);
      this.resumeFollowers();
      return result;
    } catch (error) {
      if (error instanceof ModelError && error.status === 0)
        throw new StorageError("network", { url: delivery.url, method: "PUT", cause: error });
      if (error instanceof ModelError && error.status === 412)
        throw conflictError(delivery.url, error.etag);
      throw error;
    }
  };
  private readonly deliver: ReplayDelegate = async (delivery) => {
    const intent = intentSchema.parse(
      JSON.parse(new TextDecoder().decode(delivery.body ?? new Uint8Array())),
    );
    const pending = this.options.outbox()?.pending() ?? [];
    if (intent.dependsOn.some((id) => pending.some((item) => item.id === id)))
      throw new Error(DEPENDENCY_MESSAGE);
    // A same-resource follower rebases on whatever its predecessor's resolution left. A
    // scoped prerequisite (e.g. a child remap before a move deletes its source) must apply.
    if (intent.requires.some((id) => !this.applied.has(id))) throw new Error(SKIPPED_MESSAGE);
    const assertions = z.object({ url: z.string() }).parse(delivery.assertions);
    if (
      intent.url !== assertions.url ||
      (delivery.purpose !== "resolve-both" && delivery.url !== intent.url) ||
      (delivery.purpose === "resolve-both" && delivery.container !== new URL(".", intent.url).href)
    )
      throw new Error("Invalid Tasks replay destination");
    let before = intent.before === null ? null : await parse(intent.url, intent.before);
    const after = intent.after === null ? null : await parse(intent.url, intent.after);
    if (delivery.purpose === "resolve-both") {
      if (!after) throw new Error("A deleted task cannot be copied");
      const data = taskDetails(intent.url, after);
      if (!data) throw new Error("Only tasks can be copied");
      const outbox = this.options.outbox();
      let entry: OutboxItem | undefined;
      for (const item of outbox?.pending() ?? []) {
        if (
          item.url !== intent.url ||
          item.guard?.tag !== TASKS_REPLAY ||
          item.status !== "conflict"
        )
          continue;
        const body = await outbox?.localBody(item.id);
        if (body && equal([...body], [...(delivery.body ?? [])])) {
          entry = item;
          break;
        }
      }
      if (!entry) throw new Error("Missing Tasks queue entry");
      // Both the destination and model defaults must survive a lost response.
      const url = new URL(`tasks-copy-${encodeURIComponent(entry.id)}.ttl`, intent.url).href;
      const dataset = createTask(url, {
        ...data,
        title: `${data.title} (copy)`,
        created: data.created ?? new Date(entry.createdAt),
      });
      await this.createOnce(url, dataset);
      return;
    }
    if (!before && delivery.purpose === "resolve-mine")
      before = (await this.io.read(intent.url)).dataset;
    if (!before) {
      if (!after) throw new Error("Missing task contents");
      const result = await this.createOnce(intent.url, after);
      const local = `"tasks-offline-${intent.revision}"`;
      this.confirm(intent.url, local, result.etag);
      this.options.onConfirm?.(intent.url, local, result.etag);
      return;
    }
    let current: Resource;
    try {
      current = await this.io.read(intent.url);
    } catch (error) {
      if (!after && error instanceof ModelError && [404, 410].includes(error.status)) return;
      throw error;
    }
    if (!after) {
      const base = (this.options.baseEtag ?? this.baseEtag)(intent.url, intent.etag);
      if (delivery.purpose === "replay" && (!base || current.etag !== base))
        throw conflictError(intent.url, current.etag);
      try {
        await this.io.remove(intent.url, current.etag);
      } catch (error) {
        if (!(error instanceof ModelError && [404, 410].includes(error.status))) throw error;
      }
      return;
    }
    const original = taskDetails(intent.url, before);
    const theirs = taskDetails(intent.url, current.dataset);
    const ours = taskDetails(intent.url, after);
    // The first edit asks about remote title/due/completion changes. Later field
    // patches rebase after the earlier queued revision's conflict decision.
    const keys = ["title", "dueDate", "allDay", "state"] as const;
    const changed =
      original && theirs
        ? keys.filter(
            (key) =>
              !equal(original[key], theirs[key]) && (!ours || !equal(ours[key], theirs[key])),
          )
        : [];
    if (
      delivery.purpose === "replay" &&
      !intent.etag?.startsWith('"tasks-offline-') &&
      changed.length
    )
      throw conflictError(intent.url, current.etag);
    if (original && ours && theirs) {
      const target = new TaskItem(`${intent.url}#it`, current.dataset, DataFactory);
      for (const key of Object.keys({ ...original, ...ours }) as (keyof typeof ours)[]) {
        if (key === "modified" || equal(original[key], ours[key])) continue;
        if (
          delivery.purpose === "replay" &&
          !equal(original[key], theirs[key]) &&
          !equal(ours[key], theirs[key])
        )
          throw conflictError(intent.url, current.etag);
        if (
          key === "categoryTypes" ||
          key === "completionOperations" ||
          key === "blockedBy" ||
          key === "relatesTo"
        ) {
          const values = key === "categoryTypes" ? target.types : target[key];
          for (const value of (original[key] ?? []) as string[])
            if (!(ours[key] as string[] | undefined)?.includes(value)) values.delete(value);
          for (const value of (ours[key] ?? []) as string[]) values.add(value);
        } else Reflect.set(target, key, ours[key]);
      }
      target.modified = new Date();
      validateTask(
        taskDetails(intent.url, current.dataset) as NonNullable<ReturnType<typeof taskDetails>>,
      );
    } else {
      const from = new TaskTracker(`${intent.url}#this`, before, DataFactory);
      const to = new TaskTracker(`${intent.url}#this`, after, DataFactory);
      const target = new TaskTracker(`${intent.url}#this`, current.dataset, DataFactory);
      if (!from.isTracker || !to.isTracker || !target.isTracker)
        throw new Error("Invalid Tasks document");
      for (const key of ["title", "description", "position", "color", "archivedAt"] as const) {
        if (equal(from[key], to[key])) continue;
        if (
          delivery.purpose === "replay" &&
          !equal(target[key], from[key]) &&
          !equal(target[key], to[key])
        )
          throw conflictError(intent.url, current.etag);
        Reflect.set(target, key, to[key]);
      }
      for (const kind of ["Section", "Label"] as const) {
        const key = kind === "Section" ? "sections" : "labels";
        for (const category of to[key]) {
          const previous = from[key].find((value) => value.id === category.id);
          if (equal(previous, category)) continue;
          const remote = target[key].find((value) => value.id === category.id);
          if (delivery.purpose === "replay" && !equal(remote, previous) && !equal(remote, category))
            throw conflictError(intent.url, current.etag);
          if (!previous) {
            const added = target.defineCategory(
              kind,
              category.name,
              category.position,
              category.color,
            );
            if (added.id !== category.id) throw conflictError(intent.url, current.etag);
          } else {
            const value = node(category.id, current.dataset);
            if (previous.name !== category.name) value.setText(`${NS.RDFS}label`, category.name);
            if (previous.position !== category.position)
              value.setNumber(`${SCHEMA}position`, category.position);
            if (previous.color !== category.color) value.setText(`${SCHEMA}color`, category.color);
          }
        }
        for (const category of from[key]) {
          if (to[key].some((value) => value.id === category.id)) continue;
          if (
            delivery.purpose === "replay" &&
            !equal(
              category,
              target[key].find((value) => value.id === category.id),
            )
          )
            throw conflictError(intent.url, current.etag);
          for (const quad of current.dataset.match(DataFactory.namedNode(category.id)))
            current.dataset.delete(quad);
        }
      }
      if (!equal(from.groupMembers, to.groupMembers)) {
        const members = new Set(target.groupMembers);
        for (const member of from.groupMembers)
          if (!to.groupMembers.includes(member)) members.delete(member);
        for (const member of to.groupMembers) members.add(member);
        target.setGroupMembers([...members]);
      }
      target.modified = new Date();
    }
    try {
      const result = await this.io.write(intent.url, current.dataset, { etag: current.etag });
      const local = `"tasks-offline-${intent.revision}"`;
      this.confirm(intent.url, local, result.etag);
      this.options.onConfirm?.(intent.url, local, result.etag);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 412)
        throw conflictError(intent.url, null);
      throw error;
    }
  };
  private async createOnce(url: string, dataset: Parameters<RdfIO["write"]>[1]) {
    try {
      return await this.io.write(url, dataset, { create: true });
    } catch (error) {
      if (!(error instanceof ModelError && error.status === 412)) throw error;
      const current = await this.io.read(url);
      if (!isomorphic([...dataset], [...current.dataset])) throw error;
      return current;
    }
  }
}

/** Offline startup uses the already protected Inbox; it must not provision ACLs without a connection. */
export class OfflineTaskStore extends TaskStore {
  constructor(
    options: ConstructorParameters<typeof TaskStore>[0],
    private readonly online: () => boolean,
    private readonly together: <T>(run: () => Promise<T>) => Promise<T> = (run) => run(),
  ) {
    super(options);
  }
  /** A move's writes stay ordered across resources if any of them has to queue. */
  override prepareTaskMove(...args: Parameters<TaskStore["prepareTaskMove"]>) {
    const move = super.prepareTaskMove(...args);
    const run = move.run.bind(move);
    move.run = () => this.together(run);
    return move;
  }
  override async bootstrapInbox() {
    if (this.online()) {
      try {
        return await super.bootstrapInbox();
      } catch (error) {
        if (!(error instanceof ModelError && error.status === 0) && !networkError(error))
          throw error;
      }
    }
    return this.readProject(`${this.projects}inbox.ttl`);
  }
}
