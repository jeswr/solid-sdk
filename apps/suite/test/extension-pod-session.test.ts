// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseSession,
  type ExtensionPodSessionDeps,
  ExtensionSessionError,
  openExtensionSession,
  requestStorageAccess,
  STORAGE_CLASS,
} from "../src/lib/session/extension-pod-session";
import type { SolidExtensionGrant } from "../src/lib/session/extension-session";

const { namedNode, literal, quad } = DataFactory;
const WEBID = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile#me";
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";
const storageGrant = (targets = ["https://alice.example/"]): SolidExtensionGrant => ({
  grantId: "storage",
  dataClass: STORAGE_CLASS,
  modes: ["read", "write"],
  purpose: "Solid Suite",
  expiresAt: Date.now() + 60_000,
  targets: targets.map((url) => ({ url, kind: "container" })),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(roots = ["https://alice.example/"]) {
  const dataset = new Store();
  const grant = storageGrant(roots);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("pod bytes"));
  const api = {
    webId: WEBID as string | null,
    fetch,
    listGrants: vi.fn(async (): Promise<readonly SolidExtensionGrant[]> => [grant]),
    revokeGrant: vi.fn(async (_grantId: string) => true),
    requestAccess: vi.fn(async (_request: unknown) => ({ ok: true })),
  };
  const win = Object.assign(new EventTarget(), { solid: api });
  const read = vi.fn<NonNullable<ExtensionPodSessionDeps["fetchRdf"]>>(async () => ({ dataset }));
  const pageFetch = vi.fn<typeof globalThis.fetch>(async () => new Response("public profile"));
  let generation = 1;
  const deps: ExtensionPodSessionDeps = {
    window: win,
    fetchRdf: read,
    fetch: pageFetch,
    generation,
    isCurrent: (captured) => captured === generation,
  };
  return { api, deps, grant, dataset, win, read, fetch, pageFetch, invalidate: () => ++generation };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live storage grants", () => {
  it("uses container targets, preferring the WebID origin then lexical order without probing", async () => {
    const f = fixture([
      "https://z.example/",
      "https://a.example/",
      "https://alice.example/z/",
      "https://alice.example/a/",
    ]);
    f.api.listGrants.mockResolvedValue([
      {
        ...f.grant,
        targets: [...f.grant.targets, { url: "https://alice.example/0/", kind: "instance" }],
      },
    ]);
    const session = await openExtensionSession(f.api, f.deps);
    expect(session).toMatchObject({
      mode: "extension",
      webId: WEBID,
      storageUrl: "https://alice.example/a/",
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.api.listGrants).toHaveBeenCalledOnce();
  });
  it("sorts foreign roots and ignores profile-advertised storage", async () => {
    const f = fixture(["https://z.example/", "https://a.example/z/", "https://a.example/a/"]);
    f.dataset.add(
      quad(
        namedNode(WEBID),
        namedNode("http://www.w3.org/ns/pim/space#storage"),
        namedNode("https://alice.example/"),
      ),
    );
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe("https://a.example/a/");
  });
  it.each([
    "localhost",
    "127.0.0.1",
    "127.12.0.2",
    "[::1]",
    "dev.localhost",
    "pod.example",
  ])("allows HTTP container targets on host %s", async (host) => {
    const root = `http://${host}:3000/alice/`;
    const f = fixture([root]);
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe(root);
  });
  it("rejects unusable targets without a privileged or profile read", async () => {
    const f = fixture([
      "file:///pod/",
      "javascript:alert(1)",
      "data:text/plain,pod",
      "not a url",
      "https://user:secret@pod.example/",
      "https://:secret@pod.example/",
      "https://pod.example/#fragment",
      "https://pod.example/file",
      "https://pod.example/?query",
    ]);
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({
      name: "ExtensionSessionError",
      code: "no-storage",
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
  it("distinguishes a missing grant from a grant with no container root", async () => {
    const f = fixture([]);
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({ code: "no-storage" });
    f.api.listGrants.mockResolvedValue([]);
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({
      code: "not-granted",
    });
    await expect(
      openExtensionSession(f.api, { ...f.deps, grant: { ...f.grant, modes: ["read"] } }),
    ).rejects.toMatchObject({ code: "not-granted" });
  });
  it.each([
    {},
    { webId: WEBID },
    { fetch: vi.fn() },
  ])("requires WebID and fetch as well as a grant (%j)", async (api) => {
    await expect(openExtensionSession(api, fixture().deps)).rejects.toMatchObject({
      code: "not-granted",
    });
  });
  it("requires grant introspection when no decision was supplied", async () => {
    const f = fixture();
    Object.assign(f.api, { listGrants: undefined });
    await expect(openExtensionSession(f.api, f.deps)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it("accepts a provider's grant decision without reading grants again", async () => {
    const f = fixture();
    await openExtensionSession(f.api, { ...f.deps, grant: f.grant });
    expect(f.api.listGrants).not.toHaveBeenCalled();
  });
  it.each([
    { dataClass: "https://schema.org/Person" },
    { modes: ["read"] },
    { modes: ["write"] },
    { expiresAt: 100 },
    { expiresAt: 99 },
    { expiresAt: Number.NaN },
  ])("does not select Drive from %j", (overrides) => {
    expect(chooseSession([{ ...storageGrant(), ...overrides }], 100)).toBeUndefined();
  });
  it("selects a live read/write storage grant, skipping other grants", () => {
    const grant = storageGrant();
    expect(chooseSession([{ ...grant, dataClass: "contacts" }, grant])).toBe(grant);
    expect(chooseSession([])).toBeUndefined();
  });
  it("recovers when consent appends a usable grant after an empty one", async () => {
    const f = fixture();
    const empty = { ...f.grant, grantId: "old", targets: [] };
    expect(chooseSession([empty])).toBeUndefined();
    const grants = [empty, f.grant];
    expect(chooseSession(grants)).toBe(f.grant);
    f.api.listGrants.mockResolvedValue(grants);
    expect((await openExtensionSession(f.api, f.deps)).storageUrl).toBe("https://alice.example/");
    expect(grants[0]).toBe(empty);
  });
});

describe("public profile decoration", () => {
  it("fetches the public document using the page fetch with credentials omitted", async () => {
    const f = fixture();
    f.read.mockImplementation(async (url, { fetch }) => {
      await fetch(url, { headers: { accept: "text/turtle" }, credentials: "include" });
      return { dataset: f.dataset };
    });
    await openExtensionSession(f.api, f.deps);
    expect(f.read).toHaveBeenCalledWith("https://alice.example/profile/card", {
      fetch: expect.any(Function),
    });
    expect(f.pageFetch).toHaveBeenCalledExactlyOnceWith(expect.any(Request));
    const request = f.pageFetch.mock.calls[0]?.[0] as Request;
    expect(request).toMatchObject({
      url: "https://alice.example/profile/card",
      credentials: "omit",
    });
    expect(request.headers.get("accept")).toBe("text/turtle");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { foaf: "Alice", vcard: "Alice VCard", expected: "Alice" },
    { foaf: " ", vcard: "Alice VCard", expected: "Alice VCard" },
    { foaf: undefined, vcard: undefined, expected: WEBID },
  ])("reads literal names in preference order with a WebID fallback (%j)", async ({
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
  it("opens even if the public profile fails", async () => {
    const f = fixture();
    f.read.mockRejectedValue(new Error("private or malformed profile"));
    expect((await openExtensionSession(f.api, f.deps)).displayName).toBe(WEBID);
  });
  it("uses real fetch-rdf and browser defaults without an extension profile request", async () => {
    const f = fixture();
    vi.stubGlobal("window", f.win);
    const pageFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(`<${WEBID}> <${FOAF_NAME}> "Public Alice".`, {
          headers: { "content-type": "text/turtle" },
        }),
    );
    vi.stubGlobal("fetch", pageFetch);
    const session = await openExtensionSession(f.api);
    expect(session.displayName).toBe("Public Alice");
    expect(pageFetch).toHaveBeenCalledWith(expect.any(Request));
    expect(pageFetch.mock.calls[0]?.[0]).toMatchObject({
      url: "https://alice.example/profile/card",
      credentials: "omit",
    });
    expect(f.fetch).not.toHaveBeenCalled();
    const listener = vi.fn();
    const stop = session.subscribe(listener);
    f.win.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledWith(session.storageUrl);
    stop();
  });
});

describe("identity and generation binding", () => {
  it.each([
    "grants",
    "profile",
  ])("rejects a delayed %s opening after an account switch", async (phase) => {
    const f = fixture();
    const gate = deferred<readonly SolidExtensionGrant[]>();
    const profile = deferred<{ dataset: Store }>();
    if (phase === "grants") f.api.listGrants.mockReturnValueOnce(gate.promise);
    else f.read.mockReturnValueOnce(profile.promise);
    const opening = openExtensionSession(f.api, f.deps);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    f.api.webId = BOB;
    gate.resolve([f.grant]);
    profile.resolve({ dataset: f.dataset });
    await expect(opening).rejects.toMatchObject({ code: "stale" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    "account",
    "generation",
    "stub",
    "expiry",
  ])("invalidates operations before dispatch after %s changes", async (change) => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    if (change === "account") f.api.webId = BOB;
    if (change === "generation") f.invalidate();
    if (change === "stub") Object.assign(f.win, { solid: { ...f.api } });
    if (change === "expiry") vi.spyOn(Date, "now").mockReturnValue(f.grant.expiresAt);
    await expect(session.fetch("https://alice.example/file")).rejects.toMatchObject({
      code: "stale",
    });
    expect(f.fetch).not.toHaveBeenCalled();
    await expect(session.disconnect()).rejects.toMatchObject({ code: "stale" });
    expect(f.api.revokeGrant).not.toHaveBeenCalled();
    expect(() => session.subscribe(vi.fn())).toThrow(ExtensionSessionError);
  });
  it.each([
    "GET",
    "PUT",
  ])("rejects delayed %s responses after a switch, including rejected transports", async (method) => {
    for (const reject of [false, true]) {
      const f = fixture();
      const session = await openExtensionSession(f.api, f.deps);
      const response = deferred<Response>();
      f.fetch.mockReturnValueOnce(response.promise);
      const request = session.fetch("https://alice.example/file", {
        method,
        ...(method === "PUT" ? { body: new Uint8Array([0, 128, 255]) } : {}),
      });
      expect(f.fetch).toHaveBeenCalledOnce();
      f.api.webId = BOB;
      if (reject) response.reject(new Error("transport failed"));
      else response.resolve(new Response("Alice bytes"));
      await expect(request).rejects.toMatchObject({ code: "stale" });
    }
  });
  it("stops a delayed upload before it can use Bob's fetch", async () => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    const body = deferred<ArrayBuffer>();
    const upload = (async () =>
      session.fetch("https://alice.example/image.png", {
        method: "PUT",
        body: await body.promise,
      }))();
    const bobFetch = vi.fn<typeof fetch>();
    f.api.webId = BOB;
    f.api.fetch = bobFetch;
    body.resolve(new Uint8Array([0, 128, 255]).buffer);
    await expect(upload).rejects.toMatchObject({ code: "stale" });
    expect(bobFetch).not.toHaveBeenCalled();
  });
  it("rechecks a public fetch await without hiding stale errors behind the name fallback", async () => {
    const f = fixture();
    const response = deferred<Response>();
    f.pageFetch.mockReturnValueOnce(response.promise);
    f.read.mockImplementation(async (url, { fetch }) => {
      await fetch(url);
      return { dataset: f.dataset };
    });
    const opening = openExtensionSession(f.api, f.deps);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    f.api.webId = BOB;
    response.resolve(new Response("profile"));
    await expect(opening).rejects.toMatchObject({ code: "stale" });
  });
  it("delegates current requests at call time, preserving inputs and binary bodies", async () => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    const replacement = vi.fn<typeof fetch>(async () => new Response("new"));
    f.api.fetch = replacement;
    const input = new Request("https://alice.example/file");
    const init = { method: "PUT", body: new Uint8Array([0, 128, 255]) };
    expect(await (await session.fetch(input, init)).text()).toBe("new");
    expect(replacement).toHaveBeenCalledWith(input, init);
    Object.assign(f.api, { fetch: undefined });
    await expect(session.fetch(input)).rejects.toMatchObject({ code: "not-granted" });
  });
  it("checks callbacks before and after dispatch and removes only its own listener", async () => {
    const f = fixture();
    const add = vi.spyOn(f.win, "addEventListener");
    const session = await openExtensionSession(f.api, f.deps);
    const first = vi.fn();
    const second = vi.fn();
    const stop = session.subscribe(first);
    const stopSecond = session.subscribe(second);
    f.win.dispatchEvent(new Event("focus"));
    expect(first).toHaveBeenCalledExactlyOnceWith(session.storageUrl);
    stop();
    f.win.dispatchEvent(new Event("focus"));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    const callback = add.mock.calls[1]?.[1] as () => void;
    f.api.webId = BOB;
    expect(callback).toThrow(ExtensionSessionError);
    expect(second).toHaveBeenCalledTimes(2);
    f.api.webId = WEBID;
    session.subscribe(() => f.invalidate());
    expect(add.mock.calls[2]?.[1]).toThrow(ExtensionSessionError);
  });
});

describe("disconnect", () => {
  it("uses the origin disconnect API when available", async () => {
    const f = fixture();
    const disconnect = vi.fn(async () => true);
    Object.assign(f.api, { disconnect });
    const session = await openExtensionSession(f.api, f.deps);
    f.api.listGrants.mockClear();
    await session.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(f.api.listGrants).not.toHaveBeenCalled();
    expect(f.api.revokeGrant).not.toHaveBeenCalled();
  });
  it("otherwise revokes every storage grant, including expired ones, preserving other classes", async () => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    f.api.listGrants.mockResolvedValue([
      { ...f.grant, grantId: "one", expiresAt: 0 },
      { ...f.grant, grantId: "contacts", dataClass: "https://schema.org/Person" },
      { ...f.grant, grantId: "two" },
    ]);
    await session.disconnect();
    expect(f.api.revokeGrant.mock.calls).toEqual([["one"], ["two"]]);
  });
  it.each(["listGrants", "revokeGrant"])("reports an unavailable %s API", async (method) => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    Object.assign(f.api, { [method]: undefined });
    await expect(session.disconnect()).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each([
    "list",
    "revoke",
    "disconnect",
  ])("stops after a delayed %s across an account switch", async (phase) => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    const listed = deferred<readonly SolidExtensionGrant[]>();
    const removed = deferred<boolean>();
    if (phase === "list") f.api.listGrants.mockReturnValueOnce(listed.promise);
    if (phase === "revoke") {
      f.api.listGrants.mockResolvedValue([f.grant, { ...f.grant, grantId: "bob-storage" }]);
      f.api.revokeGrant.mockReturnValueOnce(removed.promise);
    }
    if (phase === "disconnect") Object.assign(f.api, { disconnect: vi.fn(() => removed.promise) });
    const closing = session.disconnect();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    f.api.webId = BOB;
    listed.resolve([{ ...f.grant, grantId: "bob-storage" }]);
    removed.resolve(true);
    await expect(closing).rejects.toMatchObject({ code: "stale" });
    expect(f.api.revokeGrant).not.toHaveBeenCalledWith("bob-storage");
    if (phase === "list") expect(f.api.revokeGrant).not.toHaveBeenCalled();
  });
  it("surfaces grant-management failures while the session remains current", async () => {
    const f = fixture();
    const session = await openExtensionSession(f.api, f.deps);
    f.api.revokeGrant.mockRejectedValue(new Error("offline"));
    await expect(session.disconnect()).rejects.toThrow("offline");
  });
});

describe("requestStorageAccess", () => {
  it.each([
    true,
    false,
  ])("requests whole storage with the agreed arguments, returning ok=%s", async (ok) => {
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
