// AUTHORED-BY Codex GPT-6
import type { StorageClient } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, it, vi } from "vitest";
import {
  createOwnerOnlyDestinationChecks,
  createOwnerOnlyDestinationVerifier,
  ownerPolicy,
  writeWac,
} from "./index.js";

const TEST_POD_ROOT = "https://pod.example/alice/";
const TEST_WEBID = "https://alice.example/profile#me";

function createMemoryPod() {
  const documents = new Map<string, string>([
    [TEST_POD_ROOT, ""],
    [
      `${TEST_POD_ROOT}.acl`,
      `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.
      <#owner> a acl:Authorization; acl:agent <${TEST_WEBID}>;
        acl:accessTo <${TEST_POD_ROOT}>; acl:default <${TEST_POD_ROOT}>;
        acl:mode acl:Read, acl:Write, acl:Control.
    `,
    ],
  ]);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      documents.set(url, String(init.body ?? ""));
      let parent = new URL(".", url.replace(/\/$/, "")).href;
      while (!documents.has(parent)) {
        documents.set(parent, "");
        parent = new URL("../", parent).href;
      }
      return new Response(null, { status: 201, headers: { etag: '"created"' } });
    }
    const body = documents.get(url);
    if (body === undefined) return new Response(null, { status: 404 });
    const links = [`<${url}.acl>; rel="acl"`];
    if (url === TEST_POD_ROOT) links.push('<http://www.w3.org/ns/pim/space#Storage>; rel="type"');
    return new Response(init?.method === "HEAD" ? null : body, {
      headers: { link: links.join(", "), etag: '"observed"', "content-type": "text/turtle" },
    });
  };
  return { fetch };
}

describe("owner-only destination verifier", () => {
  const root = TEST_POD_ROOT;
  const parent = `${root}integrations/`;
  const container = `${parent}bank-statements/`;
  const target = `${container}statement.ttl`;
  const ownerWebId = TEST_WEBID;

  function fixture(
    override?: (
      url: string,
      init?: RequestInit,
    ) => Response | undefined | Promise<Response | undefined>,
  ) {
    const pod = createMemoryPod();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      return (await override?.(String(input), init)) ?? pod.fetch(input, init);
    });
    const backend = createSolidBackend({ root, fetch });
    const storage: StorageClient = {
      ...backend,
      features: {
        ...backend.features,
        accessControl: { state: "available", evidence: "fixture", detail: { model: "wac" } },
      },
    };
    const openStorage = vi.fn(() => storage);
    const verify = createOwnerOnlyDestinationVerifier({ podRoot: root, ownerWebId, openStorage });
    const requests = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    return { pod, fetch, storage, openStorage, verify, requests };
  }

  async function seedPublicRead(fetch: typeof globalThis.fetch, url: string, members: boolean) {
    const policy = ownerPolicy(ownerWebId, members);
    const [owner] = policy.grants;
    if (!owner) throw new Error("Expected an owner grant");
    policy.grants.push({ ...owner, modes: new Set(["read"]), who: [[{ kind: "public" }]] });
    await fetch(`${url}.acl`, {
      method: "PUT",
      body: await writeWac(policy, url, `${url}.acl`),
    });
  }

  it("reads the public parent policy before refusing to create its child", async () => {
    const { pod, verify, requests } = fixture();
    await seedPublicRead(pod.fetch, parent, true);
    expect(await verify(target)).toBe(false);
    expect(requests()).toEqual([
      `HEAD ${container}`,
      `HEAD ${parent}`,
      `HEAD ${parent}`,
      `HEAD ${parent}.acl`,
      `GET ${parent}.acl`,
    ]);
  });

  it("stops at an unreadable ACL without attempting to create anything", async () => {
    const { verify, requests } = fixture((url) =>
      url === `${root}.acl` ? new Response(null, { status: 403 }) : undefined,
    );
    expect(await verify(target)).toBe(false);
    expect(requests()).toEqual([
      `HEAD ${container}`,
      `HEAD ${parent}`,
      `HEAD ${root}`,
      `HEAD ${root}`,
      `HEAD ${root}.acl`,
    ]);
  });

  it("creates missing containers at their exact URLs, verifying each before proceeding", async () => {
    const { fetch, verify, requests, openStorage } = fixture();
    expect(await verify(target)).toBe(true);
    expect(requests()).toEqual([
      `HEAD ${container}`,
      `HEAD ${parent}`,
      `HEAD ${root}`,
      `HEAD ${root}`,
      `HEAD ${root}.acl`,
      `GET ${root}.acl`,
      `PUT ${parent}`,
      `HEAD ${parent}`,
      `HEAD ${parent}.acl`,
      `HEAD ${root}`,
      `HEAD ${root}.acl`,
      `GET ${root}.acl`,
      `PUT ${container}`,
      `HEAD ${container}`,
      `HEAD ${container}.acl`,
      `HEAD ${parent}`,
      `HEAD ${parent}.acl`,
      `HEAD ${root}`,
      `HEAD ${root}.acl`,
      `GET ${root}.acl`,
      `HEAD ${target}`,
    ]);
    for (const [, init] of fetch.mock.calls.filter(([, init]) => init?.method === "PUT")) {
      expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
      expect(new Headers(init?.headers).get("link")).toContain("ldp#BasicContainer");
      expect(init?.body).toBe("");
    }
    expect(await verify(`${container}other.ttl`)).toBe(true);
    expect(openStorage).toHaveBeenCalledTimes(1);
    expect(requests().filter((request) => request.startsWith("PUT "))).toHaveLength(2);
  });

  it("checks the guard before creating each missing container", async () => {
    const { verify, requests } = fixture();
    const puts = () => requests().filter((request) => request.startsWith("PUT "));
    const putsBeforeGuard: string[][] = [];
    const guard = () => {
      putsBeforeGuard.push(puts());
      return undefined;
    };

    await expect(verify.beforeWrite?.(target, guard)).resolves.toBe(true);
    expect(putsBeforeGuard).toEqual([[], [`PUT ${parent}`]]);
    expect(puts()).toEqual([`PUT ${parent}`, `PUT ${container}`]);
  });

  it.each([parent, container])("propagates a refusal before creating %s", async (blocked) => {
    const { storage, requests } = fixture();
    const refusal = new Error("The session refused further mutations");
    const guard = vi.fn(() =>
      blocked === parent || requests().includes(`PUT ${parent}`)
        ? Promise.reject(refusal)
        : undefined,
    );
    const { verifyPrivateDestination } = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });

    await expect(verifyPrivateDestination.beforeWrite?.(target, guard)).rejects.toBe(refusal);
    expect(requests().filter((request) => request.startsWith("PUT "))).toEqual(
      blocked === parent ? [] : [`PUT ${parent}`],
    );
    expect(requests()).not.toContain(`HEAD ${target}`);
  });

  it.each([
    "owner-only",
    "public",
  ])("checks the resulting %s container after a concurrent create", async (access) => {
    const { pod, verify, requests } = fixture(async (url, init) => {
      if (url !== container || init?.method !== "PUT") return;
      await pod.fetch(url, init);
      if (access === "public") await seedPublicRead(pod.fetch, container, true);
      return new Response(null, { status: 412 });
    });
    expect(await verify(target)).toBe(access === "owner-only");
    const recorded = requests();
    const afterCreate = recorded.slice(recorded.indexOf(`PUT ${container}`) + 1);
    expect(afterCreate.slice(0, 2)).toEqual([`HEAD ${container}`, `HEAD ${container}.acl`]);
    expect(afterCreate.slice(-2)).toEqual(
      access === "public"
        ? [`HEAD ${container}.acl`, `GET ${container}.acl`]
        : [`GET ${root}.acl`, `HEAD ${target}`],
    );
  });

  it("refuses errors other than a precondition conflict during creation", async () => {
    const { verify, requests } = fixture((url, init) =>
      url === parent && init?.method === "PUT" ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(verify(target)).rejects.toMatchObject({ status: 403 });
    expect(requests().at(-1)).toBe(`PUT ${parent}`);
    expect(requests()).not.toContain(`PUT ${container}`);
  });

  it("checks an existing resource's policy even with owner-only member defaults", async () => {
    const { pod, verify, requests } = fixture();
    await pod.fetch(target, { method: "PUT", body: "" });
    await seedPublicRead(pod.fetch, target, false);
    expect(await verify(target)).toBe(false);
    expect(requests().slice(-4)).toEqual([
      `HEAD ${target}`,
      `HEAD ${target}`,
      `HEAD ${target}.acl`,
      `GET ${target}.acl`,
    ]);
    expect(requests()).toContain(`GET ${root}.acl`);
    expect(requests().every((request) => !request.startsWith("PUT "))).toBe(true);
  });

  it("rejects an out-of-scope target before opening storage", async () => {
    const { openStorage, verify, requests } = fixture();
    await expect(verify(new URL("../bob/statement.ttl", root).href)).rejects.toThrow();
    expect(openStorage).not.toHaveBeenCalled();
    expect(requests()).toEqual([]);
  });

  it.each([
    { protocol: "lws" },
    { root: new URL("../", root).href },
  ] as const)("refuses a mismatched storage backend (%j) before any requests", async (mismatch) => {
    const { storage, requests } = fixture();
    const verify = createOwnerOnlyDestinationVerifier({
      podRoot: root,
      ownerWebId,
      openStorage: () => ({ ...storage, ...mismatch }),
    });
    expect(await verify(target)).toBe(false);
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => ({ ...storage, ...mismatch }),
    });
    expect(await checks.confirmPrivateWrite(target, {})).toBe(false);
    expect(requests()).toEqual([]);
  });

  it("refuses a missing pod root without creating containers", async () => {
    const { verify, requests } = fixture((url) =>
      url === root ? new Response(null, { status: 404 }) : undefined,
    );
    expect(await verify(target)).toBe(false);
    expect(requests()).toEqual([`HEAD ${container}`, `HEAD ${parent}`, `HEAD ${root}`]);
  });

  it.each([{ status: 206 }, { url: parent }, { kind: "resource" }] satisfies Partial<
    Awaited<ReturnType<StorageClient["head"]>>
  >[])("rejects unexpected container metadata (%j)", async (metadata) => {
    const { pod, storage, verify, requests } = fixture();
    await pod.fetch(container, { method: "PUT", body: "" });
    const head = storage.head;
    vi.spyOn(storage, "head").mockImplementation(async (url, options) => ({
      ...(await head(url, options)),
      ...metadata,
    }));
    await expect(verify(target)).rejects.toThrow("Unexpected destination metadata.");
    expect(requests()).toEqual([`HEAD ${container}`]);
  });

  it("propagates cancellation before sending requests and before returning success", async () => {
    const controller = new AbortController();
    const { storage, requests } = fixture();
    const head = storage.head;
    vi.spyOn(storage, "head").mockImplementation(async (url, options) => {
      try {
        return await head(url, options);
      } finally {
        if (url === target) controller.abort();
      }
    });
    const openStorage = vi.fn(() => storage);
    const verify = createOwnerOnlyDestinationVerifier({
      podRoot: root,
      ownerWebId,
      openStorage,
      signal: controller.signal,
    });
    await expect(verify(target)).rejects.toMatchObject({ name: "AbortError" });
    expect(requests().at(-1)).toBe(`HEAD ${target}`);
    const count = requests().length;
    await expect(verify(target)).rejects.toMatchObject({ name: "AbortError" });
    expect(requests()).toHaveLength(count);
    expect(openStorage).toHaveBeenCalledExactlyOnceWith();
  });

  it("confirms with an independent client after the run is cancelled", async () => {
    const controller = new AbortController();
    const { pod, storage, requests, fetch } = fixture();
    const runHead = vi.fn(storage.head);
    const openStorage = vi.fn((signal?: AbortSignal) =>
      signal ? { ...storage, head: runHead } : storage,
    );
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage,
      signal: controller.signal,
    });

    expect(await checks.verifyPrivateDestination(target)).toBe(true);
    expect(openStorage).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(runHead).toHaveBeenCalledWith(target, {
      revalidate: true,
      signal: controller.signal,
    });
    for (const [, init] of fetch.mock.calls.filter(([, init]) => init?.method === "PUT"))
      expect(init?.signal).toBe(controller.signal);

    await pod.fetch(target, { method: "PUT", body: "" });
    const beforeAbort = runHead.mock.calls.length;
    controller.abort();
    fetch.mockClear();

    const observe = vi.fn();
    expect(await checks.confirmPrivateWrite(target, { etag: '"observed"' }, observe)).toBe(true);
    expect(observe).toHaveBeenCalledExactlyOnceWith('"observed"');
    expect(requests().filter((request) => request === `HEAD ${target}`)).toHaveLength(3);
    expect(requests().every((request) => /^(HEAD|GET) /.test(request))).toBe(true);
    expect(await checks.confirmPrivateWrite(target, {})).toBe(true);
    expect(openStorage.mock.calls).toEqual([[controller.signal], []]);
    expect(runHead).toHaveBeenCalledTimes(beforeAbort);
  });

  it.each([
    ["missing ETag", null],
    ["weak ETag", 'W/"observed"'],
    ["different ETag", '"replacement"'],
  ] as const)("refuses the first HEAD with %s", async (_case, etag) => {
    const { pod, storage, requests } = fixture();
    await pod.fetch(target, { method: "PUT" });
    const head = storage.head;
    vi.spyOn(storage, "head").mockImplementation(async (url, options) => ({
      ...(await head(url, options)),
      etag,
    }));
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    const observe = vi.fn();
    expect(await checks.confirmPrivateWrite(target, { etag: '"observed"' }, observe)).toBe(false);
    expect(requests()).toEqual([`HEAD ${target}`]);
    expect(observe.mock.calls).toEqual(etag === '"replacement"' ? [[etag]] : []);
  });

  it.each([404, 410])("rejects confirmation when the target HEAD returns %s", async (status) => {
    const { storage, requests } = fixture(() => new Response(null, { status }));
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    await expect(checks.confirmPrivateWrite(target, {})).rejects.toMatchObject({ status });
    expect(requests()).toEqual([`HEAD ${target}`]);
  });

  it.each([
    target,
    container,
  ])("refuses confirmation when %s has public access", async (publicUrl) => {
    const { pod, storage } = fixture();
    await pod.fetch(target, { method: "PUT" });
    // Keep the target's own policy private so the containing policy must be checked separately.
    if (publicUrl === container)
      await pod.fetch(`${target}.acl`, {
        method: "PUT",
        body: await writeWac(ownerPolicy(ownerWebId, false), target, `${target}.acl`),
      });
    await seedPublicRead(pod.fetch, publicUrl, publicUrl === container);
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    expect(await checks.confirmPrivateWrite(target, { etag: '"observed"' })).toBe(false);
  });

  it("refuses confirmation when the version changes during otherwise successful policy reads", async () => {
    let stored = false;
    let resourceHeads = 0;
    const { pod, storage, requests } = fixture(async (url, init) => {
      if (!stored || url !== target || init?.method !== "HEAD") return;
      if (++resourceHeads === 2)
        await pod.fetch(url, { method: "PUT", body: "Concurrent version" });
      const response = await pod.fetch(url, init);
      response.headers.set("etag", resourceHeads === 1 ? '"imported"' : '"concurrent"');
      return response;
    });
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    expect(await checks.verifyPrivateDestination(target)).toBe(true);
    await pod.fetch(target, { method: "PUT", body: "Imported version" });
    stored = true;
    await expect(checks.confirmPrivateWrite(target, { etag: '"imported"' })).resolves.toBe(false);
    expect(resourceHeads).toBe(3);
    expect(requests().at(-1)).toBe(`HEAD ${target}`);
  });

  it.each([
    ["after the policy reads", [3]],
    ["during the policy reads", [2, 3]],
    ["during the policy reads and then returns to the write ETag", [2]],
  ] as const)("refuses confirmation when the version changes %s", async (_case, changedHeads) => {
    let resourceHeads = 0;
    const { pod, storage, requests } = fixture((url, init) => {
      if (url !== target || init?.method !== "HEAD") return;
      resourceHeads++;
      if (changedHeads.some((n) => n === resourceHeads))
        return new Response(null, {
          headers: { etag: '"replacement"', link: `<${target}.acl>; rel="acl"` },
        });
    });
    await pod.fetch(target, { method: "PUT" });
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    expect(await checks.confirmPrivateWrite(target, { etag: '"observed"' })).toBe(false);
    expect(resourceHeads).toBe(3);
    expect(requests().at(-1)).toBe(`HEAD ${target}`);
  });
});
