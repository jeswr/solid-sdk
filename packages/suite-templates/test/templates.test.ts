// AUTHORED-BY Codex GPT-6.1-Sol

import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage as actualMemoryStorage } from "@jeswr/storage-client/memory";
import { assert, describe, expect, it, vi } from "vitest";
import {
  createTemplateStore as actualCreateTemplateStore,
  BUILTIN_TEMPLATES,
  builtinsForApp,
  parseTemplateDocument,
  serializeTemplate,
  TEMPLATE_APPS,
  TEMPLATE_CLASS,
  TemplateAccessError,
  templateModel,
} from "../src/index.js";

// The Solid memory backend drops creation type hints. Preserve them in this transport fixture,
// as a server supporting the collection type link does; production Solid also registers the index.
function createMemoryStorage(options: Parameters<typeof actualMemoryStorage>[0]) {
  const storage = actualMemoryStorage(options);
  const types = new Map<string, string[]>();
  const create = storage.create.bind(storage);
  const head = storage.head.bind(storage);
  storage.create = async (...args) => {
    const result = await create(...args);
    types.set(
      result.url,
      args[2]?.links?.filter((link) => link.rel === "type").map((link) => link.target) ?? [],
    );
    return result;
  };
  storage.head = async (...args) => {
    const result = await head(...args);
    const links = new Map(result.links);
    links.set("type", [
      ...(links.get("type") ?? []),
      ...(types.get(result.url) ?? []).map((target) => ({ params: {}, target })),
    ]);
    return { ...result, links };
  };
  return storage;
}
function createTemplateStore(
  options: Omit<Parameters<typeof actualCreateTemplateStore>[0], "ensurePrivateAccess"> & {
    ensurePrivateAccess?: (url: string, context: { created: boolean }) => Promise<boolean>;
  },
) {
  return actualCreateTemplateStore({
    ensurePrivateAccess: async () => true,
    onEntryError: () => {},
    ...options,
  });
}
const root = "https://pod.example/alice/";
const metadata = {
  name: "Meeting",
  description: "For teams",
  app: "docs" as const,
  category: "Work",
  previewText: "Agenda",
  previewImage: "https://example.org/preview.png",
  author: `${root}profile#me`,
};
const input = { metadata, content: () => ({ body: "<p>Agenda</p>", contentType: "text/html" }) };
const now = () => new Date("2026-11-11T12:00:00Z");
function failure(code: ConstructorParameters<typeof StorageError>[0]) {
  return new StorageError(code, { message: "failed", url: root, method: "GET" });
}
function override(storage: StorageClient, methods: Partial<StorageClient>): StorageClient {
  return { ...storage, ...methods };
}
describe("built-ins", () => {
  it("ships every requested template with unique IDs, previews, categories and neutral content", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(11);
    expect(new Set(BUILTIN_TEMPLATES.map((value) => value.id)).size).toBe(11);
    for (const app of TEMPLATE_APPS) {
      const templates = builtinsForApp(app);
      expect(templates).toHaveLength({ docs: 4, sheets: 3, notes: 2, tasks: 2 }[app]);
      for (const template of templates) {
        expect(template.app).toBe(app);
        expect(template.category).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.previewText).toBeTruthy();
        if (template.content.format === "grid")
          for (const row of template.content.rows)
            expect(row.length).toBe(template.content.rows[0]?.length);
        if (template.content.format === "tasks")
          expect(
            template.content.sections.every((section) => section.name && section.titles.length),
          ).toBe(true);
        if (template.content.format === "markdown")
          expect(template.content.markdown.startsWith("# ")).toBe(true);
      }
    }
  });
});
describe("generated metadata", () => {
  it("round-trips all fields through the generated model", async () => {
    const data = {
      ...metadata,
      content: `${root}templates/content`,
      created: now(),
      modified: now(),
    };
    expect(
      await parseTemplateDocument(
        `${root}templates/meta`,
        await serializeTemplate(`${root}templates/meta`, data),
      ),
    ).toEqual(data);
    expect(templateModel.subject(`${root}templates/meta`)).toBe(`${root}templates/meta#it`);
  });
  it.each([
    "name",
    "app",
    "category",
    "content",
  ])("fails closed for missing or invalid required %s", (field) => {
    const data = { ...metadata, content: `${root}templates/content`, [field]: "" };
    expect(templateModel.parse(root, templateModel.build(root, data))).toBeUndefined();
  });
  it("rejects unsafe subjects, unknown app slugs and non-HTTP content", () => {
    expect(() =>
      templateModel.build("relative", { ...metadata, content: `${root}content` }),
    ).toThrow();
    for (const data of [
      { ...metadata, app: "mail", content: `${root}content` },
      { ...metadata, content: "javascript:alert(1)" },
    ])
      expect(templateModel.parse(root, templateModel.build(root, data as never))).toBeUndefined();
  });
});
for (const protocol of ["solid", "lws"] as const)
  describe(`${protocol} template store`, () => {
    it("lists an absent collection without creating it", async () => {
      const storage = createMemoryStorage({ root, protocol });
      const create = vi.spyOn(storage, "create");
      const store = createTemplateStore({ storage });
      expect(await store.list()).toEqual([]);
      expect(await store.read(`${root}templates/missing`)).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    });
    it("saves independent snapshots, recovers the container, filters, reads, validates and deletes metadata and content", async () => {
      const storage = createMemoryStorage({ root, protocol, pageSize: 1 });
      const store = createTemplateStore({ storage, now });
      const saved = await store.save(input);
      const next = await store.save({
        ...input,
        metadata: { ...metadata, name: "A note", app: "notes" },
      });
      expect(saved.data.created).toEqual(now());
      expect(saved.data.modified).toEqual(now());
      expect(saved.data.content).not.toBe(next.data.content);
      expect(await store.read(saved.id)).toEqual(saved);
      const reopened = createTemplateStore({ storage });
      expect(await reopened.list()).toHaveLength(2);
      expect((await reopened.list("docs")).map((value) => value.id)).toEqual([saved.id]);
      expect(await reopened.list("tasks")).toEqual([]);
      expect(await reopened.content(saved)).toEqual({
        body: "<p>Agenda</p>",
        contentType: "text/html",
      });
      await reopened.delete(saved);
      expect(await reopened.read(saved.id)).toBeUndefined();
      await reopened.delete(saved);
      await expect(storage.read(saved.data.content)).rejects.toMatchObject({ code: "not-found" });
    });
    it("rejects invalid metadata before writing and propagates content failures without publishing metadata", async () => {
      const storage = createMemoryStorage({ root, protocol });
      const store = createTemplateStore({ storage });
      const create = vi.spyOn(storage, "create");
      await expect(store.save({ ...input, metadata: { ...metadata, name: " " } })).rejects.toThrow(
        "Invalid template metadata",
      );
      expect(create).not.toHaveBeenCalled();
      await expect(
        store.save({
          ...input,
          content: () => {
            throw new Error("conversion failed");
          },
        }),
      ).rejects.toThrow("conversion failed");
      expect(await store.list()).toEqual([]);
    });
    it("rejects stale reads and stale deletes without removing newer records", async () => {
      const storage = createMemoryStorage({ root, protocol });
      const store = createTemplateStore({ storage });
      const saved = await store.save(input);
      await storage.write(
        saved.id,
        await serializeTemplate(saved.id, { ...saved.data, name: "Updated" }),
        { contentType: "text/turtle", ifMatch: saved.etag },
      );
      await expect(store.content(saved)).rejects.toThrow("changed");
      await expect(store.delete(saved)).rejects.toMatchObject({ code: "precondition-failed" });
      const latest = await store.read(saved.id);
      expect(latest?.data.name).toBe("Updated");
      assert(latest);
      await store.delete(latest);
      await expect(store.content(saved)).rejects.toThrow("changed");
    });
    it("ignores non-template RDF, folders and non-RDF content", async () => {
      const storage = createMemoryStorage({ root, protocol });
      const store = createTemplateStore({ storage });
      const saved = await store.save(input);
      const parent = (await storage.read(saved.id)).parent;
      assert(parent);
      await storage.create(parent, null, { kind: "container", name: "folder" });
      const empty = await storage.create(parent, "", { contentType: "text/turtle" });
      expect(await store.read(empty.url)).toBeUndefined();
      expect(await store.list()).toHaveLength(1);
    });
  });
it("registers the collection through the private Type Index", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  // A real generated RDF document can serve as the initial profile; the Type Index preserves it.
  const profile = await storage.create(
    root,
    await serializeTemplate(`${root}profile`, { ...metadata, content: `${root}content` }),
    { name: "profile", contentType: "text/turtle" },
  );
  const store = createTemplateStore({ storage, profile: `${profile.url}#me` });
  const saved = await store.save(input);
  expect(saved.data.name).toBe("Meeting");
  const { createTypeIndex } = await import("@jeswr/pod-type-index");
  expect(
    await createTypeIndex({
      storage,
      features: storage.features,
      profile: `${profile.url}#me`,
    }).find(TEMPLATE_CLASS),
  ).toEqual([`${root}templates/`]);
});
it("propagates permission failures instead of treating them as empty, and retries failed initialization", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const head = vi.fn().mockRejectedValueOnce(failure("forbidden")).mockImplementation(storage.head);
  const store = createTemplateStore({ storage: override(storage, { head }) });
  await expect(store.list()).rejects.toMatchObject({ code: "forbidden" });
  const create = vi
    .fn()
    .mockRejectedValueOnce(failure("network"))
    .mockImplementation(storage.create);
  const retrying = createTemplateStore({ storage: override(storage, { create }) });
  await expect(retrying.save(input)).rejects.toMatchObject({ code: "network" });
  await expect(retrying.save(input)).resolves.toMatchObject({ data: { name: "Meeting" } });
});
it("refuses a non-container collection location", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({
    storage: override(storage, {
      head: async (url) => ({ ...(await storage.head(root)), url, kind: "resource" }),
    }),
  });
  await expect(store.list()).rejects.toThrow("not a container");
});
it("rejects foreign, self-referential and fragment content links before fetching them", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({ storage });
  const saved = await store.save(input);
  for (const content of [
    "https://attacker.example/private",
    saved.id,
    `${saved.data.content}#fragment`,
    `${saved.data.content}?query`,
  ]) {
    const latest = await storage.read(saved.id);
    await storage.write(saved.id, await serializeTemplate(saved.id, { ...saved.data, content }), {
      contentType: "text/turtle",
      ifMatch: latest.etag ?? "",
    });
    await expect(store.read(saved.id)).rejects.toThrow();
    await expect(store.delete(saved)).rejects.toThrow();
    expect(await storage.head(saved.id)).toBeDefined();
  }
  await expect(store.read("https://attacker.example/meta")).rejects.toThrow();
  await expect(store.read(`${root}templates/`)).rejects.toThrow("resource");
});
it.each([
  null,
  'W/"weak"',
  "*",
  "unquoted",
])("refuses missing/weak validators (%s)", async (etag) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({
    storage: override(storage, {
      read: async (...args) => ({ ...(await storage.read(...args)), etag }),
    }),
  });
  await expect(store.save(input)).rejects.toThrow("strong ETag");
});
it("does not overwrite a raced content reservation", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({
    storage: override(storage, {
      read: async (...args) => ({
        ...(await storage.read(...args)),
        bytes: async () => new Uint8Array([1]),
      }),
    }),
  });
  await expect(store.save(input)).rejects.toThrow("content is no longer empty");
});
it("does not overwrite a raced metadata reservation", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  let reads = 0;
  const store = createTemplateStore({
    storage: override(storage, {
      read: async (...args) => {
        const result = await storage.read(...args);
        return ++reads === 2 ? { ...result, bytes: async () => new Uint8Array([1]) } : result;
      },
    }),
  });
  await expect(store.save(input)).rejects.toThrow("metadata is no longer empty");
});
it("propagates unreadable metadata", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  const store = createTemplateStore({
    storage: override(storage, {
      readRdf: async () => {
        throw failure("forbidden");
      },
    }),
  });
  await expect(store.read(saved.id)).rejects.toMatchObject({ code: "forbidden" });
});

it("bounds collection scans instead of silently truncating", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  await createTemplateStore({ storage }).save(input);
  const store = createTemplateStore({
    storage: override(storage, {
      async *listAll() {
        for (let i = 0; i <= 1000; i++)
          yield {
            url: `${root}templates/${i}.template.ttl`,
            kind: "resource" as const,
            contentType: null,
            size: null,
            modified: null,
            types: [],
          };
      },
    }),
  });
  await expect(store.list()).rejects.toThrow("Too many template resources");
});
it("recovers a concurrent container create without overwriting it", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const create = vi.fn<StorageClient["create"]>().mockImplementation(async (...args) => {
    if (args[2]?.kind === "container") {
      await storage.create(...args);
      throw failure("conflict");
    }
    return storage.create(...args);
  });
  expect(
    (await createTemplateStore({ storage: override(storage, { create }) }).save(input)).data.name,
  ).toBe("Meeting");
});
it("rejects unversioned metadata reads", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  const store = createTemplateStore({
    storage: override(storage, {
      readRdf: async (...args) => ({ ...(await storage.readRdf(...args)), etag: null }),
    }),
  });
  await expect(store.read(saved.id)).rejects.toThrow("strong ETag");
});
it("returns a safe media fallback when a server omits the content type", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  const store = createTemplateStore({
    storage: override(storage, {
      read: async (...args) => ({ ...(await storage.read(...args)), contentType: null }),
    }),
  });
  expect((await store.content(saved)).contentType).toBe("application/octet-stream");
});
it("propagates a later listing page failure instead of returning partial data", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  const store = createTemplateStore({
    storage: override(storage, {
      async *listAll() {
        yield {
          url: saved.id,
          kind: "resource" as const,
          contentType: null,
          size: null,
          modified: null,
          types: [],
        };
        throw failure("network");
      },
    }),
  });
  await expect(store.list()).rejects.toMatchObject({ code: "network" });
});
it("lists context-free JSON-LD metadata and ignores malformed RDF siblings", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({ storage });
  const saved = await store.save(input);
  const jsonld = await storage.create(`${root}templates/`, null, {
    name: "jsonld.template.ttl",
    contentType: "application/ld+json",
  });
  await storage.writeRdf(
    jsonld.url,
    templateModel.build(jsonld.url, { ...saved.data, name: "JSON-LD template" }),
    { contentType: "application/ld+json", ifMatch: jsonld.etag ?? "" },
  );
  await storage.create(`${root}templates/`, "not valid turtle", {
    name: "bad.template.ttl",
    contentType: "text/turtle",
  });
  expect((await store.list()).map((item) => item.data.name)).toEqual([
    "JSON-LD template",
    "Meeting",
  ]);
});
it("returns the generated model's normalized metadata rather than untrusted input fields", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({ storage });
  const saved = await store.save({
    ...input,
    metadata: {
      ...metadata,
      name: "Meeting\u001b",
      author: "javascript:alert(1)",
      previewImage: "data:image/png;base64,AA==",
    },
  });
  expect(saved.data.name).toBe("Meeting");
  expect(saved.data.author).toBeUndefined();
  expect(saved.data.previewImage).toBeUndefined();
  expect((await store.read(saved.id))?.data).toEqual(saved.data);
});
it("skips and reports corrupt records while reading only metadata with one collection lookup", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  await storage.create(`${root}templates/`, "{}", {
    name: "orphan.content",
    contentType: "application/json",
  });
  const bad = await storage.create(
    `${root}templates/`,
    await serializeTemplate(`${root}templates/bad.template.ttl`, {
      ...saved.data,
      content: "https://evil.example/content",
    }),
    { name: "bad.template.ttl", contentType: "text/turtle" },
  );
  const weak = await storage.create(
    `${root}templates/`,
    await serializeTemplate(`${root}templates/weak.template.ttl`, saved.data),
    { name: "weak.template.ttl", contentType: "text/turtle" },
  );
  const readRdf = vi.fn<StorageClient["readRdf"]>().mockImplementation(async (...args) => {
    const result = await storage.readRdf(...args);
    return args[0] === weak.url ? { ...result, etag: 'W/"weak"' } : result;
  });
  const head = vi.fn(storage.head);
  const onEntryError = vi.fn();
  const store = createTemplateStore({
    storage: override(storage, { head, readRdf }),
    onEntryError,
  });
  expect(await store.list()).toEqual([saved]);
  expect(onEntryError.mock.calls.map(([url]) => url).sort()).toEqual([bad.url, weak.url].sort());
  expect(head).toHaveBeenCalledTimes(1);
  expect(readRdf).toHaveBeenCalledTimes(3);
  await store.list();
  expect(head).toHaveBeenCalledTimes(1);
});
it("does not count a failed-save orphan or other content against the metadata limit", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const store = createTemplateStore({ storage });
  await expect(
    store.save({
      ...input,
      content: () => {
        throw new Error("conversion");
      },
    }),
  ).rejects.toThrow("conversion");
  const saved = await store.save(input);
  const entry = (await storage.list(`${root}templates/`)).items.find(
    (item) => item.url !== saved.id,
  );
  assert(entry);
  const readRdf = vi.fn(storage.readRdf);
  const listed = createTemplateStore({
    storage: override(storage, {
      readRdf,
      async *listAll() {
        for (let i = 0; i < 1500; i++) yield entry;
        yield { ...entry, url: saved.id };
      },
    }),
  });
  expect(await listed.list()).toEqual([saved]);
  expect(readRdf).toHaveBeenCalledExactlyOnceWith(saved.id);
});
it("refuses to save private content if access provisioning fails, and retries verification", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const ensurePrivateAccess = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const content = vi.fn(input.content);
  const store = createTemplateStore({ storage, ensurePrivateAccess });
  await expect(store.save({ metadata, content })).rejects.toThrow("nothing was saved");
  expect(content).not.toHaveBeenCalled();
  expect((await storage.list(`${root}templates/`)).items).toEqual([]);
  await store.save({ metadata, content });
  expect(ensurePrivateAccess).toHaveBeenCalledTimes(2);
});
it("never adopts an LWS container just because it is named templates or typed CreativeWork", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const other = await storage.create(root, null, {
    name: "templates",
    kind: "container",
    links: [{ rel: "type", target: "http://schema.org/CreativeWork" }],
  });
  const store = createTemplateStore({ storage });
  expect(await store.list()).toEqual([]);
  const saved = await store.save(input);
  expect(await store.container()).not.toBe(other.url);
  expect(await createTemplateStore({ storage }).list()).toEqual([saved]);
});
it("preflights paired content scope and validators before any deletion", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const saved = await createTemplateStore({ storage }).save(input);
  const remove = vi.fn(storage.delete);
  const weak = createTemplateStore({
    storage: override(storage, {
      delete: remove,
      head: async (url) => {
        const result = await storage.head(url);
        return url === saved.data.content ? { ...result, etag: 'W/"weak"' } : result;
      },
    }),
  });
  await expect(weak.delete(saved)).rejects.toThrow("strong ETag");
  expect(remove).not.toHaveBeenCalled();
  const raced = createTemplateStore({
    storage: override(storage, {
      delete: async (url, options) => {
        if (url === saved.data.content)
          await storage.write(url, "new", {
            contentType: "text/plain",
            ifMatch: options?.ifMatch ?? "",
          });
        return storage.delete(url, options);
      },
    }),
  });
  await expect(raced.delete(saved)).rejects.toMatchObject({ code: "precondition-failed" });
  expect(await (await storage.read(saved.data.content)).text()).toBe("new");
});
it.each([
  "solid",
  "lws",
] as const)("deletes %s metadata whose paired content was already removed", async (protocol) => {
  const storage = createMemoryStorage({ root, protocol });
  const store = createTemplateStore({ storage });
  const saved = await store.save(input);
  await storage.delete(saved.data.content, {
    ifMatch: (await storage.head(saved.data.content)).etag ?? "",
  });
  await store.delete(saved);
  expect(await store.list()).toEqual([]);
});
it("recovers typed LWS containers when the server has no Type Search Service", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const created = await storage.create(root, null, {
    name: "opaque-library",
    kind: "container",
    links: [{ rel: "type", target: TEMPLATE_CLASS }],
  });
  const store = createTemplateStore({ storage, profile: `${root}profile#me` });
  expect(await store.container()).toBe(created.url);
  await store.save(input);
  expect(await store.list()).toHaveLength(1);
});
it("preserves metadata names when LWS chooses opaque resource identifiers", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  let id = 0;
  const opaque = override(storage, {
    create: (parent, body, options) =>
      storage.create(parent, body, { ...options, name: `opaque-${++id}` }),
  });
  const store = createTemplateStore({ storage: opaque });
  const saved = await store.save(input);
  expect(saved.id).not.toMatch(/\.template\.ttl$/);
  expect(await store.list()).toEqual([saved]);
  await store.assertContains(saved.data.content);
  await expect(store.assertContains(`${root}outside`)).rejects.toThrow();
});
it("refuses an untyped conventional Solid container, including create conflicts", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  await storage.create(root, null, { kind: "container", name: "templates" });
  const store = createTemplateStore({ storage });
  expect(await store.list()).toEqual([]);
  await expect(store.save(input)).rejects.toMatchObject({ code: "conflict" });
});
it("copies images into sibling resources before publishing metadata and normalizes previews", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const asset = await storage.create(root, new Uint8Array([1, 2, 3]), {
    name: "source.png",
    contentType: "image/png",
  });
  const store = createTemplateStore({ storage });
  const saved = await store.save({
    ...input,
    content: async (_url, { copyImages }) => {
      const json = await copyImages({ type: "image", attrs: { src: asset.url } }, root);
      return {
        body: JSON.stringify(json),
        contentType: "application/json",
        previewText: "A copied image",
      };
    },
  });
  const content = JSON.parse((await store.content(saved)).body);
  expect(await storage.parentOf(content.attrs.src)).toBe(await store.container());
  await storage.delete(asset.url, { ifMatch: asset.etag ?? "" });
  expect([...(await (await storage.read(content.attrs.src)).bytes())]).toEqual([1, 2, 3]);
  expect(saved.data.previewText).toBe("A copied image");
});
// AUTHORED-BY Claude Opus 5.5 (tests below)
it.each([
  "solid",
  "lws",
  "opaque lws",
] as const)("deletes a %s template's copied images but no other sibling", async (kind) => {
  const storage = createMemoryStorage({ root, protocol: kind === "solid" ? "solid" : "lws" });
  let id = 0;
  const backend =
    kind === "opaque lws"
      ? override(storage, {
          create: (parent, body, options) =>
            storage.create(parent, body, { ...options, name: `opaque-${++id}` }),
        })
      : storage;
  const source = await storage.create(root, new Uint8Array([1]), {
    name: "source.png",
    contentType: "image/png",
  });
  const store = createTemplateStore({ storage: backend });
  const withImages = (name: string) => ({
    metadata: { ...metadata, name },
    content: async (
      _url: string,
      { copyImages }: { copyImages: <T>(value: T, from: string | undefined) => Promise<T> },
    ) => ({
      body: JSON.stringify(await copyImages({ type: "image", attrs: { src: source.url } }, root)),
      contentType: "application/json",
    }),
  });
  const removed = await store.save(withImages("Removed"));
  const kept = await store.save(withImages("Kept"));
  const image = async (template: typeof kept) =>
    JSON.parse((await store.content(template)).body).attrs.src as string;
  const removedImage = await image(removed);
  const keptImage = await image(kept);
  const container = await store.container();
  assert(container);
  const unrelated = await storage.create(container, "x", {
    name: "notes.asset.txt",
    contentType: "text/plain",
  });
  await store.delete(removed);
  await expect(storage.head(removedImage)).rejects.toMatchObject({ code: "not-found" });
  await expect(storage.head(removed.data.content)).rejects.toMatchObject({ code: "not-found" });
  expect((await storage.head(keptImage)).kind).toBe("resource");
  expect((await storage.head(unrelated.url)).kind).toBe("resource");
  expect((await storage.head(source.url)).kind).toBe("resource");
  expect(await store.list()).toEqual([kept]);
});
it("refuses to delete a changed copied image and tolerates one already removed", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const source = await storage.create(root, new Uint8Array([1]), {
    name: "source.png",
    contentType: "image/png",
  });
  const second = await storage.create(root, new Uint8Array([2]), {
    name: "second.png",
    contentType: "image/png",
  });
  const store = createTemplateStore({ storage });
  const save = () =>
    store.save({
      metadata,
      content: async (_url, { copyImages }) => ({
        body: JSON.stringify(
          await copyImages(
            {
              type: "doc",
              content: [
                { type: "image", attrs: { src: source.url } },
                { type: "image", attrs: { src: second.url } },
              ],
            },
            root,
          ),
        ),
        contentType: "application/json",
      }),
    });
  const images = async (template: Awaited<ReturnType<typeof save>>) =>
    JSON.parse((await store.content(template)).body).content.map(
      (node: { attrs: { src: string } }) => node.attrs.src,
    ) as string[];
  const first = await save();
  const [gone, other] = await images(first);
  assert(gone && other);
  await storage.delete(gone, { ifMatch: (await storage.head(gone)).etag ?? "" });
  await store.delete(first);
  await expect(storage.head(other)).rejects.toMatchObject({ code: "not-found" });
  const again = await save();
  const [changed] = await images(again);
  assert(changed);
  const weak = createTemplateStore({
    storage: override(storage, {
      head: async (url) => {
        const result = await storage.head(url);
        return url === changed ? { ...result, etag: 'W/"weak"' } : result;
      },
    }),
  });
  await expect(weak.delete(again)).rejects.toThrow("strong ETag");
  expect((await storage.head(changed)).kind).toBe("resource");
});
it("recovers a created Solid collection that loses its type link after access verification fails", async () => {
  // The real Solid memory backend, like Solid servers, ignores the creation type link.
  const storage = actualMemoryStorage({ root, protocol: "solid" });
  const profile = await storage.create(
    root,
    await serializeTemplate(`${root}profile`, { ...metadata, content: `${root}content` }),
    { name: "profile", contentType: "text/turtle" },
  );
  const ensurePrivateAccess = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const options = { storage, profile: `${profile.url}#me`, ensurePrivateAccess };
  await expect(createTemplateStore(options).save(input)).rejects.toThrow("nothing was saved");
  const store = createTemplateStore(options);
  const saved = await store.save(input);
  expect(await store.container()).toBe(`${root}templates/`);
  expect(await createTemplateStore(options).list()).toEqual([saved]);
  expect(ensurePrivateAccess).toHaveBeenCalledTimes(2);
});
it("copies only the source's own assets on save, keeping other in-pod references unread", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const docs = await storage.create(root, null, { kind: "container", name: "docs" });
  const assets = await storage.create(docs.url, null, { kind: "container", name: "assets" });
  const own = await storage.create(assets.url, new Uint8Array([1]), {
    name: "own.png",
    contentType: "image/png",
  });
  const nested = await storage.create(assets.url, null, { kind: "container", name: "nested" });
  const deep = await storage.create(nested.url, new Uint8Array([2]), {
    name: "deep.png",
    contentType: "image/png",
  });
  const photo = await storage.create(root, new Uint8Array([3]), {
    name: "private.jpg",
    contentType: "image/jpeg",
  });
  const missing = `${assets.url}missing.png`;
  const read = vi.fn(storage.read);
  const store = createTemplateStore({ storage: override(storage, { read }) });
  const sources = [own.url, deep.url, photo.url, `${own.url}?x`, missing];
  const save = (from: string | undefined) =>
    store.save({
      metadata,
      content: async (_url, { copyImages }) => ({
        body: JSON.stringify(
          await copyImages(
            { type: "doc", content: sources.map((src) => ({ type: "image", attrs: { src } })) },
            from,
          ),
        ),
        contentType: "application/json",
      }),
    });
  const saved = await save(assets.url);
  const srcs = JSON.parse((await store.content(saved)).body).content.map(
    (node: { attrs: { src: string } }) => node.attrs.src,
  );
  expect(await storage.parentOf(srcs[0])).toBe(await store.container());
  expect(srcs.slice(1)).toEqual(sources.slice(1));
  const fetched = read.mock.calls.map(([url]) => url);
  expect(fetched).toContain(own.url);
  for (const url of [deep.url, photo.url, `${own.url}?x`]) expect(fetched).not.toContain(url);
  read.mockClear();
  const untouched = await save(undefined);
  expect(JSON.parse((await store.content(untouched)).body).content).toHaveLength(5);
  expect(read.mock.calls.map(([url]) => url)).not.toContain(own.url);
  await expect(save(own.url)).rejects.toThrow("assets container");
});
it("provisions access only for a collection it created, and only verifies an adopted one", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const ensurePrivateAccess = vi
    .fn<(url: string, context: { created: boolean }) => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  const store = createTemplateStore({ storage, ensurePrivateAccess });
  await expect(store.save(input)).rejects.toThrow(
    "Couldn't make your new templates folder private",
  );
  await store.save(input);
  expect(ensurePrivateAccess.mock.calls).toEqual([
    [`${root}templates/`, { created: true }],
    [`${root}templates/`, { created: true }],
  ]);
  const refused = vi.fn(async () => false);
  const adopted = createTemplateStore({ storage, ensurePrivateAccess: refused });
  await expect(adopted.save(input)).rejects.toBeInstanceOf(TemplateAccessError);
  await expect(adopted.save(input)).rejects.toThrow("can be opened by other people");
  expect(refused).toHaveBeenCalledTimes(2);
  expect(refused).toHaveBeenCalledWith(`${root}templates/`, { created: false });
  expect(await adopted.list()).toHaveLength(1);
});
it("skips stale, foreign and non-container registrations and recreates a deleted collection", async () => {
  const storage = actualMemoryStorage({ root, protocol: "solid" });
  const profile = await storage.create(
    root,
    await serializeTemplate(`${root}profile`, { ...metadata, content: `${root}content` }),
    { name: "profile", contentType: "text/turtle" },
  );
  const options = { storage, profile: `${profile.url}#me` };
  const first = createTemplateStore(options);
  const saved = await first.save(input);
  const container = await first.container();
  assert(container);
  const { createTypeIndex } = await import("@jeswr/pod-type-index");
  const index = createTypeIndex({ storage, features: storage.features, profile: options.profile });
  // Registrations another app wrote for a foreign origin and for a plain resource: the index
  // itself refuses to write them, so rewrite registered placeholders in the stored document.
  await index.register(TEMPLATE_CLASS, { container: `${root}placeholder/` });
  await index.register(TEMPLATE_CLASS, { container: `${root}resource/` });
  const documents = async function* (url: string): AsyncGenerator<string> {
    for (const entry of (await storage.list(url)).items) {
      if (entry.kind === "container") yield* documents(entry.url);
      else yield entry.url;
    }
  };
  for await (const url of documents(root)) {
    const response = await storage.read(url);
    const text = await response.text();
    if (text.includes(`${root}placeholder/`))
      await storage.write(
        url,
        text
          .replace(`${root}placeholder/`, "https://evil.example/t/")
          .replace(`${root}resource/`, profile.url),
        {
          contentType: response.contentType ?? "text/turtle",
          ifMatch: response.etag ?? "",
        },
      );
  }
  // The user deletes the whole templates folder.
  for (const entry of (await storage.list(container)).items)
    await storage.delete(entry.url, { ifMatch: (await storage.head(entry.url)).etag ?? "" });
  await storage.delete(container, { ifMatch: (await storage.head(container)).etag ?? "" });
  const ensurePrivateAccess = vi.fn(async () => true);
  const later = createTemplateStore({ ...options, ensurePrivateAccess });
  expect(await later.list()).toEqual([]);
  const again = await later.save(input);
  expect(again.id).not.toBe(saved.id);
  expect(ensurePrivateAccess).toHaveBeenCalledExactlyOnceWith(container, { created: true });
  expect(await createTemplateStore(options).list()).toEqual([again]);
  const failing = createTemplateStore({
    storage: override(storage, {
      head: async (url) => {
        if (url === container) throw failure("forbidden");
        return storage.head(url);
      },
    }),
    profile: options.profile,
  });
  await expect(failing.list()).rejects.toMatchObject({ code: "forbidden" });
});
