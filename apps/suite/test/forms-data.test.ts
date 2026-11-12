// AUTHORED-BY Codex (GPT-6.1 Sol)
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { sampleForms } from "../src/apps/forms/demo/sample";
import { openDemoFormsStore } from "../src/apps/forms/lib/data/demo-store";
import { createMemoryFormsStore } from "../src/apps/forms/lib/data/memory-store";
import { createPodFormsStore } from "../src/apps/forms/lib/data/pod-store";
import type { FormRuntime } from "../src/apps/forms/lib/runtime";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const root = "https://pod.example/";
const fixture = sampleForms(root);
const first = fixture.forms[0];
if (!first) throw new Error("Missing fixture");
const form = first;
const values = { q_name: "Ember Vale", q_attending: false, q_book: "Letters from the Moon" };
const session = (fetch: typeof globalThis.fetch): PodSession => ({
  mode: "demo",
  webId: `${root}profile#me`,
  displayName: "Demo",
  storageUrl: root,
  fetch,
  subscribe: () => () => {},
  reset: async () => {},
});

describe("memory forms store", () => {
  it("classifies foreign origins using its storage root", () => {
    const store = createMemoryFormsStore(root, fixture);
    expect(store.isForeign(`${root}elsewhere/form#form`)).toBe(false);
    expect(store.isForeign("https://POD.example:443/form#form")).toBe(false);
    expect(store.isForeign("https://author.example/form#form")).toBe(true);
    expect(store.isForeign("https://pod.example:8443/form#form")).toBe(true);
    expect(() => store.isForeign("javascript:alert(1)")).toThrow();
  });
  it("seeds two fictional forms and isolated responses, with defensive copies", async () => {
    const store = createMemoryFormsStore(root, fixture);
    const { forms: list } = await store.listForms();
    list[0]?.fields.pop();
    expect((await store.loadForm(form.shape)).fields).toHaveLength(4);
    expect(await store.listResponses(form)).toHaveLength(2);
    const response = await store.submit(form, values);
    expect(response.subject).toMatch(/^https:\/\/pod.example\/forms\/responses\/.+\.ttl#response$/);
    expect(response.values).toEqual(values);
    response.values.q_name = "changed";
    expect((await store.listResponses(form)).at(-1)?.values.q_name).toBe("Ember Vale");
    await expect(store.loadForm(`${root}missing`)).rejects.toThrow("Form not found");
    await expect(store.submit(form, {})).rejects.toThrow("Invalid response");
  });
  it("persists replacements and serialises mutations after a failed persistence", async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const store = createMemoryFormsStore(root, fixture, persist);
    const a = store.saveForm({ ...form, label: "Failed" });
    const caught = a.catch(() => undefined);
    const b = store.saveForm({ ...form, label: "Saved" });
    await caught;
    await b;
    expect((await store.listForms()).forms).toHaveLength(2);
    expect((await store.loadForm(form.shape)).label).toBe("Saved");
    expect(store.validate(form, values).valid).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});

describe("demo pod snapshots", () => {
  it("seeds the demo pod once and survives reopening", async () => {
    const pod = createDemoPod({ root });
    const current = session(pod.fetch);
    const store = await openDemoFormsStore(current);
    await store.submit(form, values);
    await store.saveForm({ ...form, label: "Edited title" });
    const reopened = await openDemoFormsStore(current);
    expect((await reopened.loadForm(form.shape)).label).toBe("Edited title");
    expect(await reopened.listResponses(form)).toHaveLength(3);
    expect(pod.has(`${root}forms/demo.json`)).toBe(true);
  });
  it("never opens a real pod with the demo runtime", async () => {
    const current = { ...session(vi.fn()), mode: "extension" } as unknown as PodSession;
    await expect(openDemoFormsStore(current)).rejects.toThrow("demo session");
    expect(current.fetch).not.toHaveBeenCalled();
  });
  it("rejects forbidden reads, failed seeding and corrupt snapshot versions", async () => {
    await expect(
      openDemoFormsStore(session(vi.fn().mockResolvedValue(new Response(null, { status: 403 })))),
    ).rejects.toThrow("open demo");
    const seedFailure = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 507 }));
    await expect(openDemoFormsStore(session(seedFailure))).rejects.toThrow("seed demo");
    for (const snapshot of [
      { ...fixture, version: 2 },
      { ...fixture, forms: null },
      { ...fixture, responses: null },
    ])
      await expect(
        openDemoFormsStore(session(vi.fn().mockResolvedValue(Response.json(snapshot)))),
      ).rejects.toThrow("Unsupported");
  });
  it("handles another tab winning seed creation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(Response.json(fixture, { headers: { etag: '"1"' } }));
    expect((await (await openDemoFormsStore(session(fetch))).listForms()).forms).toHaveLength(2);
  });
  it("bounds competing seed creation to three retries", async () => {
    const fetch = vi.fn(
      async (_url, init?: RequestInit) =>
        new Response(null, { status: init?.method === "PUT" ? 412 : 404 }),
    );
    await expect(openDemoFormsStore(session(fetch))).rejects.toThrow("three retries");
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it("refuses unversioned writes and retains the previous snapshot after conflict", async () => {
    const missing = await openDemoFormsStore(
      session(vi.fn().mockResolvedValue(Response.json(fixture))),
    );
    await expect(missing.saveForm(form)).rejects.toThrow("version");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fixture, { headers: { etag: '"1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    const store = await openDemoFormsStore(session(fetch));
    await expect(store.saveForm({ ...form, label: "Conflict" })).rejects.toThrow("Reload");
    expect((await store.loadForm(form.shape)).label).toBe(form.label);
  });
});

describe.each([
  "solid",
  "lws",
] as const)("runtime-backed pod adapter over %s storage", (protocol) => {
  // Runtime spies stand in for the parallel package. They do not implement RDF.
  async function setup() {
    const storage = createMemoryStorage({ root, protocol, pageSize: 1 });
    const forms = await storage.create(root, null, { kind: "container", name: "forms" });
    const responses = await storage.create(forms.url, null, {
      kind: "container",
      name: "responses",
    });
    const graph = new Store();
    const runtime: FormRuntime = {
      compileForm: vi.fn((_graph, shape) => ({ ...form, shape })),
      validate: vi.fn(() => ({ valid: true, issues: [] })),
      formToShapes: vi.fn(() => graph),
      build: vi.fn(() => graph),
      serialize: vi.fn(async () => ""),
      parse: vi.fn(() => values),
    };
    const readShapes = vi.fn(async (shape: string) =>
      storage.readRdf(shape.split("#")[0] ?? shape),
    );
    const publicFetch = vi.fn();
    const store = createPodFormsStore({
      storage,
      formsContainer: forms.url,
      responsesContainer: responses.url,
      runtime,
      readShapes,
      publicFetch,
    });
    return { storage, store, runtime, readShapes, publicFetch, forms, responses };
  }
  // A single canned RDF fixture, parameterised by subject and content, lets the
  // graph comparison run for real without implementing the parallel runtime.
  function responseFixture(runtime: FormRuntime) {
    vi.mocked(runtime.build).mockImplementation(
      (_form, subject, answers) =>
        new Store([
          DataFactory.quad(
            DataFactory.namedNode(subject),
            DataFactory.namedNode("https://schema.org/text"),
            DataFactory.literal(String(answers.q_name)),
          ),
        ]),
    );
    vi.mocked(runtime.serialize).mockImplementation(async (graph) =>
      new Writer().quadsToString([...graph]),
    );
  }
  it("uses the storage root for the same foreign-origin decision as its reader", async () => {
    const { store, readShapes } = await setup();
    expect(store.isForeign("https://POD.example:443/form#form")).toBe(false);
    expect(store.isForeign("https://author.example/form#form")).toBe(true);
    expect(store.isForeign("https://pod.example:8443/form#form")).toBe(true);
    expect(() => store.isForeign("/form")).toThrow();
    await expect(store.loadForm(`${root}missing#form`)).rejects.toThrow();
    expect(readShapes).toHaveBeenCalledExactlyOnceWith(`${root}missing#form`);
  });
  it("adopts a committed response after a lost write reply and conditional conflict", async () => {
    const { storage, store, runtime, responses } = await setup();
    responseFixture(runtime);
    const create = storage.create.bind(storage);
    const write = storage.write.bind(storage);
    const createSpy = vi.spyOn(storage, "create");
    const writeSpy = vi.spyOn(storage, "write");
    if (protocol === "solid") {
      createSpy.mockImplementationOnce(async (...args) => {
        await create(...args);
        throw new Error("lost reply");
      });
      // The HTTP Solid backend maps its If-None-Match 412 to conflict.
      createSpy.mockRejectedValueOnce(
        new StorageError("conflict", { method: "PUT", url: responses.url, status: 412 }),
      );
    } else {
      writeSpy.mockImplementationOnce(async (...args) => {
        await write(...args);
        throw new Error("lost reply");
      });
    }
    await expect(store.submit(form, values)).rejects.toThrow("lost reply");
    const read = vi.spyOn(storage, "readRdf");
    const recovered = await store.submit(form, values);
    expect(recovered.values).toEqual(values);
    expect(recovered.subject).toBe(vi.mocked(runtime.build).mock.calls[0]?.[1]);
    expect(read).toHaveBeenCalledExactlyOnceWith(recovered.subject.split("#")[0]);
    const entries = [];
    for await (const entry of storage.listAll(responses.url)) entries.push(entry);
    expect(entries).toHaveLength(1);
    if (protocol === "solid") {
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy).not.toHaveBeenCalled();
    } else {
      expect(createSpy).toHaveBeenCalledOnce();
      expect(writeSpy).toHaveBeenCalledTimes(2);
    }
    // Once confirmed, a deliberate second submission gets a new identity.
    expect((await store.submit(form, values)).subject).not.toBe(recovered.subject);
  });
  it.each([
    "content",
    "subject",
    "empty",
    "unreadable",
  ])("reports an uncertain save when the conflicted document has different %s", async (difference) => {
    const { storage, store, runtime } = await setup();
    responseFixture(runtime);
    const create = storage.create.bind(storage);
    const write = storage.write.bind(storage);
    const createSpy = vi.spyOn(storage, "create");
    const writeSpy = vi.spyOn(storage, "write");
    if (protocol === "solid")
      createSpy.mockImplementationOnce(async (...args) => {
        await create(...args);
        throw new Error("lost reply");
      });
    else
      writeSpy.mockImplementationOnce(async (...args) => {
        await write(...args);
        throw new Error("lost reply");
      });
    await expect(store.submit(form, values)).rejects.toThrow("lost reply");
    const subject = vi.mocked(runtime.build).mock.calls[0]?.[1];
    if (!subject) throw new Error("Missing submission subject");
    const url = subject.split("#")[0] ?? "";
    const current = await storage.readRdf(url);
    const changed = difference === "subject" ? `${url}#someone-else` : subject;
    const body =
      difference === "empty"
        ? ""
        : await runtime.serialize(
            runtime.build(form, changed, {
              ...values,
              q_name: difference === "content" ? "Changed answer" : values.q_name,
            }),
          );
    await write(url, body, { contentType: "text/turtle", ifMatch: current.etag ?? "" });
    const read = vi.spyOn(storage, "readRdf");
    if (difference === "unreadable") read.mockRejectedValueOnce(new Error("offline"));
    await expect(store.submit(form, values)).rejects.toThrow("Your response may already be saved");
    expect(read).toHaveBeenCalledExactlyOnceWith(url);
    expect(createSpy).toHaveBeenCalledTimes(protocol === "solid" ? 2 : 1);
    expect(writeSpy).toHaveBeenCalledTimes(protocol === "solid" ? 0 : 2);
  });
  it.each([
    false,
    true,
  ])("confirms an unversioned committed response only with a non-empty graph (%s)", async (empty) => {
    const { storage, store, runtime } = await setup();
    if (!empty) responseFixture(runtime);
    const create = storage.create.bind(storage);
    const write = storage.write.bind(storage);
    const createSpy = vi.spyOn(storage, "create");
    const writeSpy = vi.spyOn(storage, "write");
    if (protocol === "solid")
      createSpy.mockImplementationOnce(async (...args) => ({
        ...(await create(...args)),
        etag: null,
        etagSource: "follow-up",
      }));
    else
      writeSpy.mockImplementationOnce(async (...args) => ({
        ...(await write(...args)),
        etag: null,
        etagSource: "follow-up",
      }));
    vi.spyOn(storage, "readRdf").mockRejectedValueOnce(new Error("readback failed"));
    await expect(store.submit(form, values)).rejects.toThrow("Your response may already be saved");
    if (empty)
      await expect(store.submit(form, values)).rejects.toThrow(
        "Your response may already be saved",
      );
    else {
      const recovered = await store.submit(form, values);
      expect(recovered.subject).toBe(vi.mocked(runtime.build).mock.calls[0]?.[1]);
    }
    expect(createSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledTimes(protocol === "solid" ? 0 : 1);
  });
  it("respects server-assigned identifiers and uses runtime conversion on every write", async () => {
    const { storage, store, runtime } = await setup();
    const saved = await store.saveForm(form);
    expect(saved.shape).not.toBe(form.shape);
    expect(runtime.formToShapes).toHaveBeenCalledWith(
      expect.objectContaining({ shape: saved.shape }),
    );
    expect((await store.listForms()).forms).toHaveLength(1);
    expect(await store.listResponses(saved)).toEqual([]);
    // A second queued save may still carry the provisional shape from the designer.
    await store.saveForm({ ...form, label: "New" });
    expect((await store.listForms()).forms).toHaveLength(1);
    const response = await store.submit(saved, values);
    expect(runtime.build).toHaveBeenCalledWith(saved, response.subject, values);
    expect(runtime.parse).toHaveBeenCalled();
    expect(response.values).toEqual(values);
    expect((await storage.read(response.subject.split("#")[0] ?? "")).contentType).toBe(
      "text/turtle",
    );
    expect(runtime.serialize).toHaveBeenCalledTimes(3);
  });
  it("validates before allocating and refuses unsafe reservations", async () => {
    const { storage, store, runtime } = await setup();
    vi.mocked(runtime.validate).mockReturnValueOnce({ valid: false, issues: [] });
    const create = vi.spyOn(storage, "create");
    await expect(store.submit(form, {})).rejects.toThrow("Review");
    expect(create).not.toHaveBeenCalled();
    if (protocol === "lws") {
      const read = storage.read.bind(storage);
      const readSpy = vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
        ...(await read(...args)),
        bytes: async () => new Uint8Array([1]),
      }));
      await expect(store.saveForm(form)).rejects.toThrow("reserve");
      readSpy.mockImplementationOnce(async (...args) => ({ ...(await read(...args)), etag: null }));
      await expect(store.saveForm(form)).rejects.toThrow("reserve");
      await store.saveForm(form);
      expect(create).toHaveBeenCalledOnce();
    } else {
      await store.saveForm(form);
      expect(create).toHaveBeenCalledWith(
        expect.any(String),
        "",
        expect.objectContaining({ name: expect.stringMatching(/\.ttl$/) }),
      );
    }
  });
  it("reads response RDF through content negotiation", async () => {
    const { storage, store, runtime } = await setup();
    const read = vi.spyOn(storage, "readRdf");
    const response = await store.submit(form, values);
    expect(read).toHaveBeenCalledWith(response.subject.split("#")[0]);
    expect(runtime.parse).toHaveBeenCalledWith(
      form,
      response.subject,
      expect.objectContaining({ size: 0 }),
    );
  });
  it("skips empty, invalid and unreadable documents without hiding good forms", async () => {
    const { storage, store, runtime, forms } = await setup();
    const good = await store.saveForm(form);
    const empty = await storage.create(forms.url, "", { contentType: "text/turtle" });
    const invalid = await storage.create(forms.url, "This is not RDF", {
      contentType: "text/turtle",
    });
    vi.mocked(runtime.compileForm).mockImplementation((_graph, shape) => {
      if (shape === `${empty.url}#form`) throw new Error("No shape in empty document");
      return { ...form, shape };
    });
    expect(await store.listForms()).toEqual({
      forms: [{ ...form, shape: good.shape }],
      skipped: expect.arrayContaining([empty.url, invalid.url]),
    });
    expect((await store.listForms()).skipped).toHaveLength(2);
  });
  it("reuses the same document after a failed form write", async () => {
    const { storage, store } = await setup();
    const create = vi.spyOn(storage, "create");
    const write = vi.spyOn(storage, "write");
    if (protocol === "solid") create.mockRejectedValueOnce(new Error("offline"));
    else write.mockRejectedValueOnce(new Error("offline"));
    await expect(store.saveForm(form)).rejects.toThrow("offline");
    await store.saveForm(form);
    expect((await store.listForms()).forms).toHaveLength(1);
    if (protocol === "solid")
      expect(create.mock.calls[0]?.[2]?.name).toBe(create.mock.calls[1]?.[2]?.name);
    else {
      expect(create).toHaveBeenCalledOnce();
      expect(write.mock.calls[0]?.[0]).toBe(write.mock.calls[1]?.[0]);
    }
  });
  it("reuses failed response reservations and allocates anew only after success", async () => {
    const { store, runtime } = await setup();
    vi.mocked(runtime.serialize).mockRejectedValueOnce(new Error("offline"));
    await expect(store.submit(form, values)).rejects.toThrow("offline");
    const response = await store.submit(form, values);
    expect(vi.mocked(runtime.build).mock.calls[0]?.[1]).toBe(response.subject);
    expect((await store.submit(form, values)).subject).not.toBe(response.subject);
  });
  it("rejects hostile URLs before either transport and isolates foreign origin credentials", async () => {
    const { store, readShapes, publicFetch } = await setup();
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/plain,hi",
      "http://192.168.1.2/form",
      "https://me:secret@evil.example/form",
      "/form",
      "#form",
      "//evil.example/form",
      `https://evil.example/${"x".repeat(4096)}`,
    ])
      await expect(store.loadForm(hostile)).rejects.toThrow();
    expect(readShapes).not.toHaveBeenCalled();
    expect(publicFetch).not.toHaveBeenCalled();
    publicFetch.mockResolvedValueOnce(
      new Response("", { headers: { "content-type": "text/turtle" } }),
    );
    await store.loadForm("https://8.8.8.8/form#form");
    expect(readShapes).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledWith(
      "https://8.8.8.8/form",
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
    const headers = new Headers(publicFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("dpop")).toBe(false);
    publicFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: root } }),
    );
    await expect(store.loadForm("https://8.8.8.8/form#form")).rejects.toThrow();
    expect(publicFetch).toHaveBeenCalledTimes(2);
    await expect(store.loadForm("https://192.168.1.2/form")).rejects.toThrow();
    expect(publicFetch).toHaveBeenCalledTimes(2);
  });
  it("refuses follow-up validators after a successful write whose readback fails", async () => {
    const { storage, store, readShapes } = await setup();
    const saved = await store.saveForm(form);
    const write = storage.write.bind(storage);
    const mutation = vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
      ...(await write(...args)),
      etagSource: "follow-up",
    }));
    readShapes.mockRejectedValueOnce(new Error("Readback failed"));
    await expect(store.saveForm(saved)).rejects.toThrow("Readback failed");
    await expect(store.saveForm(saved)).rejects.toThrow("Reload");
    expect(mutation).toHaveBeenCalledOnce();
    // Explicit reload obtains a content-bound ETag and makes editing safe again.
    await store.loadForm(saved.shape);
    await store.saveForm(saved);
  });
  if (protocol === "solid") {
    it("refuses an unexpected named-create address", async () => {
      const { storage, store } = await setup();
      const create = storage.create.bind(storage);
      vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => ({
        ...(await create(...args)),
        url: `${root}unexpected.ttl`,
      }));
      await expect(store.saveForm(form)).rejects.toThrow("Unexpected Solid document address");
    });
    it("requires reload when a named-create readback fails without a response validator", async () => {
      const { storage, store, readShapes } = await setup();
      const create = storage.create.bind(storage);
      vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => ({
        ...(await create(...args)),
        etagSource: "follow-up",
      }));
      readShapes.mockRejectedValueOnce(new Error("Readback failed"));
      await expect(store.saveForm(form)).rejects.toThrow("Readback failed");
      await expect(store.saveForm(form)).rejects.toThrow("Reload");
    });
  }
  it("refuses missing versions and surfaces stale conditional writes", async () => {
    const { storage, store, readShapes } = await setup();
    const saved = await store.saveForm(form);
    const url = saved.shape.split("#")[0] ?? "";
    const current = await storage.read(url);
    await storage.write(url, "", { contentType: "text/turtle", ifMatch: current.etag ?? "" });
    await expect(store.saveForm(saved)).rejects.toMatchObject({ code: "precondition-failed" });
    readShapes.mockImplementationOnce(async () => ({
      ...(await storage.readRdf(url)),
      etag: null,
    }));
    await store.loadForm(saved.shape);
    await expect(store.saveForm(saved)).rejects.toThrow("Reload");
  });
});
