// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import type { TemplateApp } from "./builtins.js";
import { TEMPLATE_CLASS, type TemplateData, templateModel } from "./model.js";
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
}
export interface SaveTemplateInput {
  metadata: Omit<TemplateData, "content" | "created" | "modified">;
  content: (resource: string) => TemplateBody | Promise<TemplateBody>;
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function validator(etag: string | null): string {
  if (!etag || etag.startsWith("W/")) throw new Error("Templates require a strong ETag");
  return etag;
}
/** One account-scoped store; all I/O uses the public, credential-bounded StorageClient. */
export function createTemplateStore(options: {
  storage: StorageClient;
  profile?: string;
  fetch?: typeof fetch;
  now?: () => Date;
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
  async function locate(create: boolean): Promise<string | undefined> {
    const conventional = containerUrl ?? new URL("templates/", storage.root).href;
    try {
      const found = await storage.head(conventional);
      if (found.kind !== "container") throw new Error("The templates location is not a container");
      return found.url;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    // LWS names are hints. Recover the server's actual identifier on a later session.
    if (storage.protocol === "lws") {
      for await (const entry of storage.listAll(storage.root)) {
        if (
          entry.kind === "container" &&
          (entry.displayName === "templates" || entry.types.includes(TEMPLATE_CLASS))
        )
          return entry.url;
      }
    }
    if (!create) return undefined;
    try {
      return (
        await storage.create(storage.root, null, {
          kind: "container",
          name: "templates",
          links: [{ rel: "type", target: TEMPLATE_CLASS }],
        })
      ).url;
    } catch (error) {
      if (error instanceof StorageError && error.code === "conflict")
        return (await storage.head(conventional)).url;
      throw error;
    }
  }
  async function ensure() {
    container ??= locate(true)
      .then(async (url) => {
        if (!url) throw new Error("Missing templates container");
        containerUrl = url;
        await index?.register(TEMPLATE_CLASS, { container: url });
        return url;
      })
      .catch((error) => {
        container = undefined;
        throw error;
      });
    return container;
  }
  function scoped(url: string, root: string) {
    const target = assertWithinPodScope(root, url);
    if (target === root || new URL(target).hash || new URL(target).search)
      throw new TypeError("A template must identify a resource");
    return target;
  }
  async function read(url: string): Promise<UserTemplate | undefined> {
    const root = await locate(false);
    if (!root) return undefined;
    const resource = scoped(url, root);
    let response: Awaited<ReturnType<StorageClient["readRdf"]>>;
    try {
      response = await storage.readRdf(resource);
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    const data = templateModel.parse(resource, response.dataset);
    if (!data) return undefined;
    scoped(data.content, root);
    if (data.content === resource) throw new TypeError("Template content cannot be its metadata");
    return {
      id: resource,
      source: "user",
      app: data.app as TemplateApp,
      data,
      etag: validator(response.etag),
    };
  }
  return {
    read,
    async list(app?: TemplateApp): Promise<UserTemplate[]> {
      const root = await locate(false);
      if (!root) return [];
      const result: UserTemplate[] = [];
      let count = 0;
      for await (const entry of storage.listAll(root)) {
        if (++count > 1000) throw new Error("Too many template resources");
        const media = entry.contentType?.split(";")[0]?.trim().toLowerCase();
        if (
          entry.kind !== "resource" ||
          (media && !["text/turtle", "application/ld+json"].includes(media))
        )
          continue;
        try {
          const template = await read(entry.url);
          if (template && (!app || template.app === app)) result.push(template);
        } catch (error) {
          if (!(error instanceof StorageError && error.code === "not-rdf")) throw error;
        }
      }
      return result.sort((a, b) => a.data.name.localeCompare(b.data.name));
    },
    async content(template: UserTemplate): Promise<TemplateBody> {
      const current = await read(template.id);
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
      const body = await input.content(content.url);
      await storage.write(content.url, body.body, {
        contentType: body.contentType,
        ifMatch: validator(fresh.etag),
      });
      const metadata = await storage.create(root, null, {
        name: `${id}.template.ttl`,
        contentType: "text/turtle",
      });
      const reservation = await storage.read(metadata.url);
      if ((await reservation.bytes()).length !== 0)
        throw new Error("The template metadata is no longer empty");
      const data = { ...checked, content: content.url };
      const saved = await storage.write(
        metadata.url,
        await templateModel.serialize(metadata.url, data),
        { contentType: "text/turtle", ifMatch: validator(reservation.etag) },
      );
      return {
        id: metadata.url,
        source: "user",
        app: data.app as TemplateApp,
        data,
        etag: validator(saved.etag),
      };
    },
    async delete(template: UserTemplate): Promise<void> {
      const current = await read(template.id);
      if (!current) return;
      // Only remove the metadata: RDF links cannot authorise deleting another resource.
      // Content snapshots may be shared by other metadata records and remain ordinary documents.
      await storage.delete(current.id, { ifMatch: template.etag });
    },
  };
}
