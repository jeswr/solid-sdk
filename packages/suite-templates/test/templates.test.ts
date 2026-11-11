// AUTHORED-BY Codex GPT-6.1-Sol

import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { assert, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_TEMPLATES,
  builtinsForApp,
  createTemplateStore,
  parseTemplateDocument,
  serializeTemplate,
  TEMPLATE_APPS,
  TEMPLATE_CLASS,
  templateModel,
} from "../src/index.js";

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
    it("saves independent snapshots, recovers the container, filters, reads, validates and deletes metadata", async () => {
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
      expect(await storage.read(saved.data.content)).toBeDefined();
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
  }
  await expect(store.read("https://attacker.example/meta")).rejects.toThrow();
  await expect(store.read(`${root}templates/`)).rejects.toThrow("resource");
});
it.each([null, 'W/"weak"'])("refuses missing/weak validators (%s)", async (etag) => {
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
            url: `${root}templates/folder/`,
            kind: "container" as const,
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
    name: "jsonld",
    contentType: "application/ld+json",
  });
  await storage.writeRdf(
    jsonld.url,
    templateModel.build(jsonld.url, { ...saved.data, name: "JSON-LD template" }),
    { contentType: "application/ld+json", ifMatch: jsonld.etag ?? "" },
  );
  await storage.create(`${root}templates/`, "not valid turtle", { contentType: "text/turtle" });
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
