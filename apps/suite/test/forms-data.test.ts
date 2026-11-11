// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { Store } from "n3";
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
  it("seeds two fictional forms and isolated responses, with defensive copies", async () => {
    const store = createMemoryFormsStore(root, fixture);
    const list = await store.listForms();
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
    expect(await store.listForms()).toHaveLength(2);
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
    expect(await (await openDemoFormsStore(session(fetch))).listForms()).toHaveLength(2);
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
    const store = createPodFormsStore({
      storage,
      formsContainer: forms.url,
      responsesContainer: responses.url,
      runtime,
      readShapes,
    });
    return { storage, store, runtime, readShapes, forms, responses };
  }
  it("respects server-assigned identifiers and uses runtime conversion on every write", async () => {
    const { storage, store, runtime } = await setup();
    const saved = await store.saveForm(form);
    expect(saved.shape).not.toBe(form.shape);
    expect(runtime.formToShapes).toHaveBeenCalledWith(
      expect.objectContaining({ shape: saved.shape }),
    );
    expect(await store.listForms()).toHaveLength(1);
    expect(await store.listResponses(saved)).toEqual([]);
    // A second queued save may still carry the provisional shape from the designer.
    await store.saveForm({ ...form, label: "New" });
    expect(await store.listForms()).toHaveLength(1);
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
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
      ...(await read(...args)),
      bytes: async () => new Uint8Array([1]),
    }));
    await expect(store.saveForm(form)).rejects.toThrow("reserve");
  });
  it("passes an empty response body through the runtime's fail-closed parser", async () => {
    const { storage, store, runtime } = await setup();
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
      ...(await read(...args)),
      body: null,
    }));
    await store.submit(form, values);
    expect(runtime.parse).toHaveBeenCalledWith(
      form,
      expect.any(String),
      expect.objectContaining({ size: 0 }),
    );
  });
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
