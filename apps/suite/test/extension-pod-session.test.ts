// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseSession,
  type ExtensionPodSessionDeps,
  ExtensionSessionError,
  openExtensionSession,
  requestStorageAccess,
  STORAGE_CLASS,
} from "../src/lib/session/extension-pod-session";
import type { SolidExtensionApi } from "../src/lib/session/extension-session";

const { namedNode, literal, blankNode, quad } = DataFactory;
const WEBID = "https://alice.example/profile/card#me";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";

function fixture(storages = ["https://alice.example/"], webId = WEBID) {
  const dataset = new Store(
    storages.map((url) => quad(namedNode(webId), namedNode(STORAGE), namedNode(url))),
  );
  const win = Object.assign(new EventTarget(), { location: { reload: vi.fn() } });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  const api = {
    webId,
    fetch,
    listGrants: vi.fn(async () => [] as { grantId: string; dataClass: string }[]),
    revokeGrant: vi.fn(async (_grantId: string) => true),
    requestAccess: vi.fn(async (_request: unknown) => ({ ok: true })),
  };
  const read = vi.fn<NonNullable<ExtensionPodSessionDeps["fetchRdf"]>>(async () => ({ dataset }));
  const deps = { window: win, fetchRdf: read, reload: win.location.reload };
  return { api, deps, dataset, win, read, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe("extension storage discovery", () => {
  it("reads the WebID document through the granted fetch and prefers its origin", async () => {
    const f = fixture(["https://z.example/", "https://a.example/", "https://alice.example/pod/"]);
    const session = await openExtensionSession(f.api, f.deps);
    expect(f.read).toHaveBeenCalledWith("https://alice.example/profile/card", {
      fetch: f.api.fetch,
    });
    expect(session).toMatchObject({
      mode: "extension",
      webId: WEBID,
      storageUrl: "https://alice.example/pod/",
    });
    expect(f.fetch).toHaveBeenCalledWith(session.storageUrl, {
      method: "HEAD",
      redirect: "manual",
    });
  });

  it("sorts foreign storage roots deterministically", async () => {
    const f = fixture(["https://z.example/", "https://a.example/z/", "https://a.example/a/"]);
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe("https://a.example/a/");
  });

  it("skips unreachable roots, HTTP errors, and redirects to find a reachable storage", async () => {
    const f = fixture([
      "https://alice.example/",
      "https://a.example/",
      "https://b.example/",
      "https://c.example/",
    ]);
    f.fetch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 302 }));
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe("https://c.example/");
  });

  it("rejects foreign schemes, remote HTTP, malformed URLs, and non-IRI objects", async () => {
    const f = fixture([
      "file:///pod/",
      "javascript:alert(1)",
      "data:text/plain,pod",
      "http://pod.example/",
      "not a url",
    ]);
    f.dataset.add(quad(namedNode(WEBID), namedNode(STORAGE), literal("https://literal.example/")));
    f.dataset.add(quad(namedNode(WEBID), namedNode(STORAGE), blankNode()));
    f.dataset.add(
      quad(
        namedNode("https://other.example/#me"),
        namedNode(STORAGE),
        namedNode("https://other.example/"),
      ),
    );
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({
      name: "ExtensionSessionError",
      code: "no-storage",
    });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "127.12.0.2",
    "[::1]",
    "dev.localhost",
  ])("allows HTTP on loopback host %s", async (host) => {
    const root = `http://${host}:3000/alice/`;
    const f = fixture([root]);
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe(root);
  });

  it.each([
    { roots: [] },
    { roots: ["https://denied.example/"] },
  ])("throws a typed no-storage error when no storage is reachable (%j)", async ({ roots }) => {
    const f = fixture(roots);
    f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(openExtensionSession(f.api, f.deps)).rejects.toBeInstanceOf(ExtensionSessionError);
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({ code: "no-storage" });
  });

  it("rejects embedded credentials and storage fragments before probing", async () => {
    const f = fixture([
      "https://user:secret@pod.example/",
      "https://:secret@pod.example/",
      "https://pod.example/#fragment",
      "http://127.evil.example/",
    ]);
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({ code: "no-storage" });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("uses the real fetch-rdf and browser defaults when dependencies are omitted", async () => {
    const f = fixture();
    const writer = new Writer();
    writer.addQuads(f.dataset.getQuads(null, null, null, null));
    const body = await new Promise<string>((resolve, reject) =>
      writer.end((error, result) => (error ? reject(error) : resolve(result))),
    );
    f.fetch.mockResolvedValueOnce(
      new Response(body, { headers: { "content-type": "text/turtle" } }),
    );
    vi.stubGlobal("window", f.win);
    const session = await openExtensionSession(f.api);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    f.win.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledWith("https://alice.example/");
    unsubscribe();
    await session.disconnect();
    expect(f.win.location.reload).toHaveBeenCalledOnce();
  });
});

describe("extension session behavior", () => {
  it.each([
    { foaf: "Alice", vcard: "Alice VCard", expected: "Alice" },
    { foaf: "", vcard: "Alice VCard", expected: "Alice VCard" },
    { foaf: undefined, vcard: undefined, expected: WEBID },
  ])("reads literal profile names with a WebID fallback (%j)", async ({
    foaf,
    vcard,
    expected,
  }) => {
    const f = fixture();
    f.dataset.add(
      quad(namedNode("https://other.example/#me"), namedNode(FOAF_NAME), literal("Other")),
    );
    f.dataset.add(
      quad(namedNode(WEBID), namedNode(FOAF_NAME), namedNode("https://not-a-name.example/")),
    );
    if (foaf !== undefined)
      f.dataset.add(quad(namedNode(WEBID), namedNode(FOAF_NAME), literal(foaf)));
    if (vcard !== undefined)
      f.dataset.add(quad(namedNode(WEBID), namedNode(VCARD_FN), literal(vcard)));
    expect((await openExtensionSession(f.api, f.deps)).displayName).toBe(expected);
  });

  it("delegates fetch at call time and rejects after revocation", async () => {
    const f = fixture();
    const api: SolidExtensionApi = f.api;
    const session = await openExtensionSession(api, f.deps);
    const replacement = vi.fn<typeof fetch>(async () => new Response("new"));
    Object.assign(api, { fetch: replacement });
    const input = new Request("https://alice.example/file");
    const init = { method: "PUT", body: "hello" };
    expect(await (await session.fetch(input, init)).text()).toBe("new");
    expect(replacement).toHaveBeenCalledWith(input, init);
    Object.assign(api, { fetch: undefined });
    await expect(session.fetch(input)).rejects.toMatchObject({ code: "not-granted" });
  });

  it("subscribes on focus and removes only its own listener", async () => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = session.subscribe(first);
    const stopSecond = session.subscribe(second);
    f.win.dispatchEvent(new Event("focus"));
    expect(first).toHaveBeenCalledExactlyOnceWith(session.storageUrl);
    stopFirst();
    f.win.dispatchEvent(new Event("focus"));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    f.win.dispatchEvent(new Event("focus"));
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("revokes every storage grant and reloads after revocation, preserving other classes", async () => {
    const f = fixture();
    f.api.listGrants.mockResolvedValue([
      { grantId: "storage-1", dataClass: STORAGE_CLASS },
      { grantId: "contacts", dataClass: "https://schema.org/Person" },
      { grantId: "storage-2", dataClass: STORAGE_CLASS },
    ]);
    const session = await openExtensionSession(f.api, f.deps);
    await session.disconnect();
    expect(f.api.listGrants).toHaveBeenCalledOnce();
    expect(f.api.revokeGrant.mock.calls).toEqual([["storage-1"], ["storage-2"]]);
    expect(f.win.location.reload).toHaveBeenCalledOnce();
    expect(f.win.location.reload.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.api.revokeGrant.mock.invocationCallOrder[1] as number,
    );
  });

  it("surfaces grant-management failures without reloading", async () => {
    const f = fixture();
    f.api.listGrants.mockResolvedValue([{ grantId: "storage", dataClass: STORAGE_CLASS }]);
    f.api.revokeGrant.mockRejectedValue(new Error("offline"));
    const session = await openExtensionSession(f.api, f.deps);
    await expect(session.disconnect()).rejects.toThrow("offline");
    expect(f.win.location.reload).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { webId: WEBID },
    { fetch: vi.fn() },
  ])("requires a granted fetch and WebID (%j)", async (api) => {
    await expect(openExtensionSession(api, fixture().deps)).rejects.toMatchObject({
      code: "not-granted",
    });
  });

  it.each([
    "listGrants",
    "revokeGrant",
  ])("reports an unavailable %s API on disconnect", async (method) => {
    const f = fixture();
    Object.assign(f.api, { [method]: undefined });
    const session = await openExtensionSession(f.api, f.deps);
    await expect(session.disconnect()).rejects.toMatchObject({ code: "unavailable" });
    expect(f.win.location.reload).not.toHaveBeenCalled();
  });
});

describe("requestStorageAccess", () => {
  it.each([
    true,
    false,
  ])("requests the whole storage with the agreed consent arguments and returns ok=%s", async (ok) => {
    const f = fixture();
    f.api.requestAccess.mockResolvedValue({ ok });
    await expect(requestStorageAccess(f.api)).resolves.toBe(ok);
    expect(f.api.requestAccess).toHaveBeenCalledExactlyOnceWith({
      classes: [STORAGE_CLASS],
      modes: ["read", "write"],
      purpose: "Solid Suite",
      duration: "P30D",
    });
  });

  it("reports an unavailable consent API", async () => {
    await expect(requestStorageAccess({})).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("chooseSession", () => {
  it.each([
    [false, false, null, "demo"],
    [true, false, null, "demo"],
    [true, true, null, "demo"],
    [false, true, WEBID, "demo"],
    [true, false, WEBID, "demo"],
    [true, true, "", "demo"],
    [true, true, WEBID, "extension"],
  ] as const)("present=%s, granted=%s, webId=%s chooses %s", (present, granted, webId, expected) => {
    expect(chooseSession({ present, granted, webId })).toBe(expected);
  });
});
