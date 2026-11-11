// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";
import type { Outbox, ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { z } from "zod";
import { ModelError } from "../lib/model/errors";
import { RdfIO } from "../lib/model/io";
import { DataFactory, NS, node, parse, SCHEMA, serialize } from "../lib/model/rdf";
import { TaskStore } from "../lib/model/store";
import { createTask, TaskItem, taskDetails, validateTask } from "../lib/model/task";
import { TaskTracker } from "../lib/model/tracker";

export const TASKS_REPLAY = "tasks.intent.v1";
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
    for (const listener of this.receipts) listener(url, local, remote);
  };
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
      onCreate?: (url: string, local: string, remote: string | null) => void;
    },
  ) {
    this.key = `suite.tasks.cache.v1.${options.webId}\u0000${options.storageUrl}`;
    this.io = new RdfIO(options.fetch);
    try {
      const stored = z
        .object({ webId: z.string(), documents: z.record(z.string(), savedSchema) })
        .parse(JSON.parse(options.storage?.getItem(this.key) ?? "null"));
      if (stored.webId === options.webId)
        for (const [url, saved] of Object.entries(stored.documents)) this.documents.set(url, saved);
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
    this.keepVersion(url, this.documents.get(url));
    if (body === null) this.documents.set(url, { body: "", etag, local, deleted: true });
    else this.documents.set(url, { body, etag, local });
    const parent = new URL(".", url).href;
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
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.cleared) throw new Error("The Tasks account is no longer active");
    const url = String(input);
    const method = init?.method ?? "GET";
    const outbox = this.options.outbox();
    const cached = this.documents.get(url);
    if (method === "GET") {
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
        if (
          response.ok &&
          (!response.url || response.url === url) &&
          response.headers.get("Content-Type")?.includes("turtle")
        ) {
          this.keepVersion(url, cached);
          this.documents.set(url, {
            body: await response.clone().text(),
            etag: response.headers.get("ETag"),
            local: false,
          });
          this.save();
        } else if ([401, 403, 404, 410].includes(response.status)) {
          this.documents.delete(url);
          this.save();
        }
        return response;
      } catch (error) {
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
    if (this.options.online() && !this.waiting(url)) {
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
        .filter((item) => item.guard?.tag === TASKS_REPLAY)
        .slice(-1)
        .map((item) => item.id),
    };
    await outbox.enqueue({
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

  /** Every update is re-applied through typed accessors to a newly read document. */
  readonly replay: ReplayDelegate = async (delivery, ctx) => {
    try {
      return await this.deliver(delivery, ctx);
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
    if (
      intent.dependsOn.some((id) =>
        this.options
          .outbox()
          ?.pending()
          .some((item) => item.id === id),
      )
    )
      throw new Error("An earlier Tasks change must sync first");
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
      for (let attempt = 0; attempt < 10; attempt++) {
        const url = new URL(`${crypto.randomUUID()}.ttl`, intent.url).href;
        const dataset = createTask(url, { ...data, title: `${data.title} (copy)` });
        try {
          await this.io.write(url, dataset, { create: true });
          return;
        } catch (error) {
          if (!(error instanceof Error && "status" in error && error.status === 412)) throw error;
        }
      }
      throw new Error("Couldn't find an available name for the copy");
    }
    if (!before && delivery.purpose === "resolve-mine")
      before = (await this.io.read(intent.url)).dataset;
    if (!before) {
      if (!after) throw new Error("Missing task contents");
      const result = await this.io.write(intent.url, after, { create: true });
      const local = `"tasks-offline-${intent.revision}"`;
      this.confirm(intent.url, local, result.etag);
      this.options.onCreate?.(intent.url, local, result.etag);
      return;
    }
    const current = await this.io.read(intent.url);
    const original = taskDetails(intent.url, before);
    const theirs = taskDetails(intent.url, current.dataset);
    const ours = after ? taskDetails(intent.url, after) : undefined;
    // Title, due and completion changes always need a decision, even for a different local edit.
    const keys = ["title", "dueDate", "allDay", "state"] as const;
    const changed =
      original && theirs
        ? keys.filter(
            (key) =>
              !equal(original[key], theirs[key]) && (!ours || !equal(ours[key], theirs[key])),
          )
        : [];
    if (delivery.purpose === "replay" && changed.length)
      throw conflictError(intent.url, current.etag);
    if (!after) {
      await this.io.remove(intent.url, current.etag);
      return;
    }
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
      await this.io.write(intent.url, current.dataset, { etag: current.etag });
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 412)
        throw conflictError(intent.url, null);
      throw error;
    }
  };
}

/** Offline startup uses the already protected Inbox; it must not provision ACLs without a connection. */
export class OfflineTaskStore extends TaskStore {
  constructor(
    options: ConstructorParameters<typeof TaskStore>[0],
    private readonly online: () => boolean,
  ) {
    super(options);
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
