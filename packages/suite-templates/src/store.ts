// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { displayNameOf, type StorageClient, StorageError } from "@jeswr/storage-client";
import type { TemplateApp } from "./builtins.js";
import { copyTemplateImages } from "./images.js";
import { serializeTemplate, TEMPLATE_CLASS, type TemplateData, templateModel } from "./model.js";
export interface UserTemplate {
  id: string;
  source: "user";
  app: TemplateApp;
  data: TemplateData;
  etag: string;
}
export interface TemplateBody {
  body: string;
  contentType: string;
  previewText?: string;
}
export interface SaveTemplateInput {
  metadata: Omit<TemplateData, "content" | "created" | "modified">;
  content: (
    resource: string,
    assets: {
      /**
       * Copy images that are direct children of `from` (the source's own assets container)
       * into the template. Other references are kept as they are and never fetched.
       */
      copyImages: <T>(value: T, from: string | undefined) => Promise<T>;
    },
  ) => TemplateBody | Promise<TemplateBody>;
}
/** Owner-only access to the templates collection could not be established; nothing was written. */
export class TemplateAccessError extends Error {
  constructor(created: boolean) {
    super(
      created
        ? "Couldn't make your new templates folder private, so nothing was saved. Please try again."
        : "Your templates folder can be opened by other people, so nothing was saved. Make it private, then try again.",
    );
    this.name = "TemplateAccessError";
  }
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function validator(etag: string | null): string {
  if (!etag || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag))
    throw new Error("Templates require a strong ETag");
  return etag;
}
/** One account-scoped store; all I/O uses the public, credential-bounded StorageClient. */
export function createTemplateStore(options: {
  storage: StorageClient;
  profile?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Provision (only when `created`) or verify owner-only access before any content write. */
  ensurePrivateAccess: (url: string, context: { created: boolean }) => Promise<boolean>;
  onEntryError?: (url: string, error: unknown) => void;
}) {
  const { storage } = options;
  const index = options.profile
    ? createTypeIndex({
        storage,
        features: storage.features,
        profile: options.profile,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : undefined;
  let container: Promise<string> | undefined;
  let containerUrl: string | undefined;
  // A collection this store created; kept until access is established so a retry provisions.
  let createdUrl: string | undefined;
  function remember(url: string) {
    containerUrl = url;
    return url;
  }
  async function locate(create: boolean): Promise<string | undefined> {
    if (containerUrl) return containerUrl;
    const conventional = new URL("templates/", storage.root).href;
    let registered: string[] = [];
    try {
      registered = (await index?.find(TEMPLATE_CLASS)) ?? [];
    } catch (error) {
      if (
        !(
          storage.protocol === "lws" &&
          error instanceof StorageError &&
          error.code === "unsupported"
        )
      )
        throw error;
    }
    for (const url of registered) {
      // A stale or foreign registration must not block the collection for good.
      try {
        assertWithinPodScope(storage.root, url);
      } catch {
        continue;
      }
      let found: Awaited<ReturnType<StorageClient["head"]>>;
      try {
        found = await storage.head(url);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (found.kind === "container" && found.url !== storage.root) return remember(found.url);
    }
    try {
      const found = await storage.head(conventional);
      if (found.kind !== "container") throw new Error("The templates location is not a container");
      if (found.links.get("type")?.some((link) => link.target === TEMPLATE_CLASS))
        return remember(found.url);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    // LWS names are hints: only dedicated types, never names or CreativeWork, identify a collection.
    if (storage.protocol === "lws") {
      for await (const entry of storage.listAll(storage.root)) {
        if (entry.kind === "container" && entry.types.includes(TEMPLATE_CLASS))
          return remember(entry.url);
      }
    }
    if (!create) return undefined;
    try {
      createdUrl = (
        await storage.create(storage.root, null, {
          kind: "container",
          name: "templates",
          links: [{ rel: "type", target: TEMPLATE_CLASS }],
        })
      ).url;
      return remember(createdUrl);
    } catch (error) {
      if (error instanceof StorageError && error.code === "conflict") {
        const found = await storage.head(conventional);
        if (
          found.kind === "container" &&
          found.links.get("type")?.some((link) => link.target === TEMPLATE_CLASS)
        )
          return remember(found.url);
      }
      throw error;
    }
  }
  async function ensure() {
    container ??= locate(true)
      .then(async (url) => {
        if (!url) throw new Error("Missing templates container");
        containerUrl = url;
        // Register first: Solid drops the type link, so the index is the only adoption path
        // back to a created collection. Access is still verified before every first write.
        await index?.register(TEMPLATE_CLASS, { container: url });
        const created = url === createdUrl;
        if (!(await options.ensurePrivateAccess(url, { created })))
          throw new TemplateAccessError(created);
        createdUrl = undefined;
        return url;
      })
      .catch((error) => {
        container = undefined;
        throw error;
      });
    return container;
  }
  /** LWS may choose opaque identifiers; keep the logical name in the resource's metadata. */
  async function keepName(url: string, name: string) {
    if (storage.protocol !== "lws" || new URL(url).pathname.endsWith(`/${name}`)) return;
    const description = await storage.metadata(url);
    await storage.setMetadata(url, [{ op: "add", rel: "self", href: url, title: name }], {
      ifMatch: validator(description.etag),
    });
  }
  async function scoped(url: string, root: string) {
    const target = assertWithinPodScope(storage.root, url);
    if (target === root || new URL(target).hash || new URL(target).search)
      throw new TypeError("A template must identify a resource");
    if ((await storage.parentOf(target)) !== root)
      throw new TypeError("Template resource is outside its container");
    return target;
  }
  async function readAt(
    url: string,
    root: string,
    allowMissingContent = false,
  ): Promise<UserTemplate | undefined> {
    const resource = await scoped(url, root);
    let response: Awaited<ReturnType<StorageClient["readRdf"]>>;
    try {
      response = await storage.readRdf(resource);
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    const data = templateModel.parse(resource, response.dataset);
    if (!data) return undefined;
    try {
      await scoped(data.content, root);
    } catch (error) {
      if (!allowMissingContent || !missing(error)) throw error;
    }
    if (data.content === resource) throw new TypeError("Template content cannot be its metadata");
    return {
      id: resource,
      source: "user",
      app: data.app as TemplateApp,
      data,
      etag: validator(response.etag),
    };
  }
  async function readCurrent(
    url: string,
    allowMissingContent = false,
  ): Promise<UserTemplate | undefined> {
    const root = await locate(false);
    try {
      return root ? await readAt(url, root, allowMissingContent) : undefined;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  return {
    read: (url: string) => readCurrent(url),
    container: () => locate(false),
    async assertContains(url: string): Promise<void> {
      const root = await locate(false);
      let current: string | null = assertWithinPodScope(storage.root, url);
      for (let depth = 0; current && depth < 100; depth++) {
        if (current === root) return;
        current = await storage.parentOf(current);
      }
      throw new TypeError("Resource is outside the templates container");
    },
    async list(app?: TemplateApp): Promise<UserTemplate[]> {
      const root = await locate(false);
      if (!root) return [];
      const result: UserTemplate[] = [];
      let count = 0;
      for await (const entry of storage.listAll(root)) {
        if (entry.kind !== "resource" || !displayNameOf(entry).endsWith(".template.ttl")) continue;
        if (++count > 1000) throw new Error("Too many template resources");
        try {
          const template = await readAt(entry.url, root);
          if (template && (!app || template.app === app)) result.push(template);
          else if (!template)
            (options.onEntryError ?? console.warn)(
              entry.url,
              new Error("Invalid template metadata"),
            );
        } catch (error) {
          (options.onEntryError ?? console.warn)(entry.url, error);
        }
      }
      return result.sort((a, b) => a.data.name.localeCompare(b.data.name));
    },
    async content(template: UserTemplate): Promise<TemplateBody> {
      const current = await readCurrent(template.id);
      if (!current || current.etag !== template.etag)
        throw new Error("This template changed; reopen the gallery");
      const response = await storage.read(current.data.content);
      return {
        body: await response.text(),
        contentType: response.contentType ?? "application/octet-stream",
      };
    },
    async save(input: SaveTemplateInput): Promise<UserTemplate> {
      // Validate MUST fields before making any writes. The generated builder alone is permissive.
      const time = (options.now ?? (() => new Date()))();
      const probe = {
        ...input.metadata,
        created: time,
        modified: time,
        content: new URL("templates/probe", storage.root).href,
      };
      const checked = templateModel.parse(storage.root, templateModel.build(storage.root, probe));
      if (!checked) throw new TypeError("Invalid template metadata");
      const root = await ensure();
      const id = crypto.randomUUID();
      const content = await storage.create(root, null, {
        name: `${id}.content`,
        contentType: "application/octet-stream",
      });
      const fresh = await storage.read(content.url);
      if ((await fresh.bytes()).length !== 0)
        throw new Error("The template content is no longer empty");
      const body = await input.content(content.url, {
        copyImages: async (value, from) => {
          const source = from === undefined ? undefined : assertWithinPodScope(storage.root, from);
          if (source !== undefined && !source.endsWith("/"))
            throw new TypeError("Images are copied only from an assets container");
          return copyTemplateImages(value, {
            root: storage.root,
            outside: "keep",
            copyable: async (url) =>
              source !== undefined &&
              !new URL(url).search &&
              !new URL(url).hash &&
              (await storage.parentOf(url)) === source,
            read: async (url) => {
              let image: Awaited<ReturnType<StorageClient["read"]>>;
              try {
                image = await storage.read(url);
              } catch (error) {
                if (missing(error)) return undefined;
                throw error;
              }
              return {
                data: (await image.bytes()).buffer as ArrayBuffer,
                contentType: image.contentType ?? "application/octet-stream",
              };
            },
            upload: async (data, contentType) => {
              const name = `${id}.asset.${crypto.randomUUID()}`;
              const asset = await storage.create(root, new Uint8Array(data), { name, contentType });
              await keepName(asset.url, name);
              return asset.url;
            },
          });
        },
      });
      await storage.write(content.url, body.body, {
        contentType: body.contentType,
        ifMatch: validator(fresh.etag),
      });
      const metadata = await storage.create(root, null, {
        name: `${id}.template.ttl`,
        contentType: "text/turtle",
      });
      await keepName(metadata.url, `${id}.template.ttl`);
      const reservation = await storage.read(metadata.url);
      if ((await reservation.bytes()).length !== 0)
        throw new Error("The template metadata is no longer empty");
      const data = {
        ...checked,
        ...(body.previewText === undefined ? {} : { previewText: body.previewText }),
        content: content.url,
      };
      const saved = await storage.write(metadata.url, await serializeTemplate(metadata.url, data), {
        contentType: "text/turtle",
        ifMatch: validator(reservation.etag),
      });
      return {
        id: metadata.url,
        source: "user",
        app: data.app as TemplateApp,
        data,
        etag: validator(saved.etag),
      };
    },
    async delete(template: UserTemplate): Promise<void> {
      const current = await readCurrent(template.id, true);
      if (!current) return;
      if (current.etag !== template.etag)
        throw new StorageError("precondition-failed", {
          message: "This template changed; reopen the gallery",
          url: current.id,
          method: "DELETE",
        });
      const root = await locate(false);
      if (!root) return;
      let content: Awaited<ReturnType<StorageClient["head"]>> | undefined;
      try {
        content = await storage.head(current.data.content);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      // Recheck logical membership after HEAD: a missing URL may have been recreated elsewhere.
      if (content) await scoped(current.data.content, root);
      const etag = content ? validator(content.etag) : undefined;
      // Image copies are siblings named after the metadata's logical name (see save()).
      const siblings: { url: string; name: string }[] = [];
      let prefix: string | undefined;
      for await (const entry of storage.listAll(root)) {
        if (entry.kind !== "resource") continue;
        const name = displayNameOf(entry);
        if (entry.url === current.id && name.endsWith(".template.ttl"))
          prefix = `${name.slice(0, -".template.ttl".length)}.asset.`;
        else if (name.includes(".asset.")) siblings.push({ url: entry.url, name });
      }
      await storage.delete(current.id, { ifMatch: template.etag });
      if (etag) await storage.delete(current.data.content, { ifMatch: etag });
      for (const asset of siblings) {
        if (!prefix || !asset.name.startsWith(prefix)) continue;
        try {
          const found = await storage.head(asset.url);
          await storage.delete(asset.url, { ifMatch: validator(found.etag) });
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    },
  };
}
