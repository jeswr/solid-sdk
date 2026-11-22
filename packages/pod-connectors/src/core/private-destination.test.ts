// AUTHORED-BY Codex GPT-6
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { MONZO } from "../bank-statements/fixtures.js";
import { garminAdapter } from "../garmin/adapter.js";
import { whoopAdapter } from "../whoop/adapter.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { requirePrivateWriteConfirmation } from "./pod-writer-policy.js";
import {
  createOwnerOnlyDestinationChecks,
  createOwnerOnlyDestinationVerifier,
  createSessionPrivateDestinationVerifier,
} from "./private-destination.js";
import { createStoragePodWriter, createWacImportStorage } from "./storage-pod-writer.js";
import {
  createMemoryPod,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { PodWriter } from "./types.js";

it.each([
  ["public-read parent", async () => false],
  [
    "unavailable ACL",
    async () => {
      throw new Error("ACL unavailable");
    },
  ],
  ["no verifier", undefined],
] as const)("sends no bank payload request with %s", async (_name, verify) => {
  const pod = createMemoryPod();
  const fetch = vi.fn(pod.fetch);
  const adapter = bankStatementsFileAdapter;
  const verifyPrivateDestination = verify && vi.fn(verify);
  await expect(
    runFileImport({
      adapter,
      file: memoryFile("bank.csv", MONZO),
      podWriter: createFetchPodWriter({
        adapterId: adapter.metadata.id,
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch,
        verifyPrivateDestination,
      }),
    }),
  ).rejects.toMatchObject({ name: "PrivateDestinationError" });
  if (verifyPrivateDestination)
    expect(verifyPrivateDestination).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/finance\/bank\/monzo-.*\/account\.ttl$/),
    );
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(pod.putCount).toBe(0);
});

it.each([
  garminAdapter,
  whoopAdapter,
])("refuses sensitive API imports without a verified destination ($metadata.id)", async (adapter) => {
  const write = vi.fn<PodWriter["write"]>();
  await expect(
    runImport({
      adapter,
      mode: "demo",
      podWriter: {
        resolve: (slug) => new URL(slug, TEST_POD_ROOT).href,
        read: async () => undefined,
        write,
        registerType: vi.fn(),
      },
    }),
  ).rejects.toMatchObject({ name: "PrivateDestinationError" });
  expect(write).not.toHaveBeenCalled();
});

it("fails closed when a private writer has no separate confirmation port", async () => {
  const pod = createMemoryPod();
  const writer = createFetchPodWriter({
    adapterId: "bank-statements",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
    verifyPrivateDestination: async () => true,
  });
  const payload = writer.resolve("finance/bank-transactions.ttl");
  await expect(
    runFileImport({
      adapter: bankStatementsFileAdapter,
      file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
      podWriter: writer,
    }),
  ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: true });
  expect(pod.get(payload)).toBeUndefined();
});

it("bounds unresponsive cleanup to ten seconds", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const cleanupPrivateWrite = vi.fn(() => {
    controller.abort();
    return new Promise<boolean>(() => {});
  });
  try {
    await expect(
      requirePrivateWriteConfirmation(
        "whoop",
        { cleanupPrivateWrite },
        "new.ttl",
        `${TEST_POD_ROOT}new.ttl`,
        true,
      ),
    ).rejects.toMatchObject({ phase: "after-write", removed: false });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
  } finally {
    timeout.mockRestore();
  }
});

it("redacts confirmation and cleanup errors and leaves later API writes and state blocked", async () => {
  const write = vi.fn<PodWriter["write"]>(async ({ slug, category, forClass }) => ({
    url: `${TEST_POD_ROOT}${slug}`,
    category,
    forClass,
  }));
  const registerType = vi.fn<PodWriter["registerType"]>();
  const onState = vi.fn();
  const confirmPrivateWrite = vi.fn(async () => {
    throw new Error("private confirmation failure");
  });
  const cleanupPrivateWrite = vi.fn(async () => {
    throw new Error("private cleanup failure");
  });
  const doc = { dataset: new Store(), category: "health", forClass: "urn:test:Health" };
  const adapter = {
    ...whoopAdapter,
    async import(ctx: Parameters<typeof whoopAdapter.import>[0]) {
      const first = await ctx.write({ ...doc, slug: "first.ttl" }, {}).catch((error) => error);
      await expect(ctx.write({ ...doc, slug: "next.ttl" })).rejects.toBe(first);
      await expect(ctx.remove("earlier.ttl")).rejects.toBe(first);
      return { cursor: "new-cursor" };
    },
  };
  await expect(
    runImport({
      adapter,
      mode: "demo",
      onState,
      podWriter: {
        resolve: (slug) => new URL(slug, TEST_POD_ROOT).href,
        read: async () => undefined,
        verifyPrivateDestination: async () => true,
        confirmPrivateWrite,
        cleanupPrivateWrite,
        write,
        registerType,
      },
    }),
  ).rejects.toMatchObject({
    phase: "after-write",
    url: `${TEST_POD_ROOT}first.ttl`,
    removed: false,
    message:
      "A file was written to your pod and may be visible to other people. Removal of the file could not be confirmed.",
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(registerType).not.toHaveBeenCalled();
  expect(onState).not.toHaveBeenCalled();
});

it.each([
  "API",
  "file",
] as const)("reports an after-write provenance refusal following a separate %s error", async (mode) => {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: mode === "API" ? "whoop" : "bank-statements",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
    verifyPrivateDestination: async () => true,
    confirmPrivateWrite: async () => false,
  });
  const onState = vi.fn();
  const fail = async () => {
    throw new Error("An earlier adapter error");
  };
  const run =
    mode === "API"
      ? runImport({ adapter: { ...whoopAdapter, import: fail }, mode: "demo", podWriter, onState })
      : runFileImport({
          adapter: { ...bankStatementsFileAdapter, importFile: fail },
          file: memoryFile("bank.csv", ""),
          podWriter,
          onState,
        });
  const url = podWriter.resolve("_provenance.ttl");
  await expect(run).rejects.toMatchObject({ phase: "after-write", url, removed: true });
  expect(pod.get(url)).toBeUndefined();
  expect(onState).not.toHaveBeenCalled();
});

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
    const storage = createWacImportStorage({ root, fetch });
    const openStorage = vi.fn(() => storage);
    const checks = createOwnerOnlyDestinationChecks({ podRoot: root, ownerWebId, openStorage });
    const requests = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    return {
      pod,
      fetch,
      storage,
      openStorage,
      verify: checks.verifyPrivateDestination,
      checks,
      requests,
    };
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

  it.each([
    "planted ACL",
    "concurrent share",
    "owner-only",
  ] as const)("checks the bank payload after writing with %s", async (policy) => {
    const folder = `${container}finance/`;
    const payload = `${folder}bank-transactions.ttl`;
    const provenance = `${container}_provenance.ttl`;
    const { pod, fetch, checks, requests } = fixture(async (url, init) => {
      if (url === payload && init?.method === "PUT" && policy === "concurrent share") {
        const aclUrl = `${payload}.acl`;
        // A private resource policy alone is insufficient when the container is shared.
        await pod.fetch(aclUrl, {
          method: "PUT",
          body: await writeWac(ownerPolicy(ownerWebId, false), payload, aclUrl),
        });
        await seedPublicRead(pod.fetch, folder, true);
      }
    });
    if (policy === "planted ACL") await seedPublicRead(pod.fetch, payload, false);
    const writer = createFetchPodWriter({
      adapterId: "bank-statements",
      webId: ownerWebId,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: root,
      fetch,
      ...checks,
    });
    // Isolate import mutations from the separate Type Index registration path.
    const registerType = vi.fn(async () => ({ indexUrl: "" }));
    const onState = vi.fn();
    const importing = runFileImport({
      adapter: bankStatementsFileAdapter,
      file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
      podWriter: { ...writer, registerType },
      onState,
    });
    const mutations = () => requests().filter((request) => /^(PUT|DELETE) /.test(request));
    if (policy === "owner-only") {
      await expect(importing).resolves.toMatchObject({ state: { lastOutcome: "success" } });
      expect(mutations()).toEqual([
        `PUT ${parent}`,
        `PUT ${container}`,
        `PUT ${folder}`,
        `PUT ${payload}`,
        `PUT ${provenance}`,
      ]);
    } else {
      await expect(importing).rejects.toMatchObject({
        name: "PrivateDestinationError",
        phase: "after-write",
        url: payload,
        removed: true,
      });
      expect(registerType).not.toHaveBeenCalled();
      expect(onState).not.toHaveBeenCalled();
      expect(mutations().slice(-2)).toEqual([`PUT ${payload}`, `DELETE ${payload}`]);
      const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(new Headers(deletion?.[1]?.headers).get("if-match")).toBe('"v1"');
      expect((await pod.fetch(payload)).status).toBe(404);
      expect(pod.get(provenance)).toBeUndefined();
    }
  });

  it.each([
    ["missing ETag", undefined, 204, 404, true],
    ["weak ETag", 'W/"v1"', 204, 410, true],
    ["denied DELETE", '"v1"', 403, 404, false],
    ["file still present after DELETE", '"v1"', 204, 200, false],
  ] as const)("reports cleanup with %s", async (_case, etag, deleteStatus, headStatus, removed) => {
    const folder = `${container}finance/`;
    const payload = `${folder}bank-transactions.ttl`;
    let deleting = false;
    const { pod, fetch, checks, requests } = fixture(async (url, init) => {
      if (url !== payload) return;
      if (init?.method === "PUT") {
        const response = await pod.fetch(url, init);
        if (etag === undefined) response.headers.delete("etag");
        else response.headers.set("etag", etag);
        await seedPublicRead(pod.fetch, payload, false);
        return response;
      }
      if (init?.method === "DELETE") {
        deleting = true;
        if (removed) await pod.fetch(url, init);
        return new Response(null, { status: deleteStatus });
      }
      if (deleting && init?.method === "HEAD") return new Response(null, { status: headStatus });
    });
    const writer = createFetchPodWriter({
      adapterId: "bank-statements",
      webId: ownerWebId,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: root,
      fetch,
      ...checks,
    });
    await expect(
      runFileImport({
        adapter: bankStatementsFileAdapter,
        file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
        podWriter: writer,
      }),
    ).rejects.toMatchObject({
      phase: "after-write",
      url: payload,
      removed,
      message: `A file was written to your pod and may be visible to other people. ${removed ? "The file was removed." : "Removal of the file could not be confirmed."}`,
    });
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toBe(etag === '"v1"' ? etag : null);
    expect(requests().slice(requests().indexOf(`DELETE ${payload}`))).toEqual(
      deleteStatus === 204 ? [`DELETE ${payload}`, `HEAD ${payload}`] : [`DELETE ${payload}`],
    );
    expect(pod.get(payload) === undefined).toBe(removed);
  });

  it.each([
    404,
    410,
    "version mismatch",
  ] as const)("refuses confirmation on %s", async (observation) => {
    let stored = false;
    const payload = `${container}finance/bank-transactions.ttl`;
    const { pod, fetch, checks, requests } = fixture(async (url, init) => {
      if (url !== payload) return;
      if (init?.method === "PUT") stored = true;
      if (!stored || init?.method !== "HEAD" || (await pod.fetch(url, init)).status !== 200) return;
      return observation === "version mismatch"
        ? new Response(null, { headers: { etag: '"other-version"' } })
        : new Response(null, { status: observation });
    });
    await expect(
      runFileImport({
        adapter: bankStatementsFileAdapter,
        file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
        podWriter: createFetchPodWriter({
          adapterId: "bank-statements",
          webId: ownerWebId,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: root,
          fetch,
          ...checks,
        }),
      }),
    ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: true });
    expect(requests().slice(-4)).toEqual([
      `PUT ${payload}`,
      `HEAD ${payload}`,
      `DELETE ${payload}`,
      `HEAD ${payload}`,
    ]);
  });

  it("uses a fresh cleanup signal after cancellation at the write response", async () => {
    const controller = new AbortController();
    const payload = `${container}finance/bank-transactions.ttl`;
    const { pod, fetch, checks } = fixture(async (url, init) => {
      if (url !== payload || init?.method !== "PUT") return;
      const response = await pod.fetch(url, init);
      controller.abort(new Error("private cancellation reason"));
      return response;
    });
    const writer = createFetchPodWriter({
      adapterId: "bank-statements",
      webId: ownerWebId,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: root,
      fetch,
      ...checks,
      signal: controller.signal,
    });
    await expect(
      runFileImport({
        adapter: bankStatementsFileAdapter,
        file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
        podWriter: writer,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: true });
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deletion?.[1]?.signal?.aborted).toBe(false);
    expect(pod.get(payload)).toBeUndefined();
  });

  it.each([
    "fetch",
    "storage",
  ] as const)("only removes refused binary creates with the %s writer", async (backend) => {
    const { pod, storage, fetch, checks } = fixture();
    const privacy = {
      ...checks,
      confirmPrivateWrite: vi.fn(async () => false),
    };
    const writer =
      backend === "fetch"
        ? createFetchPodWriter({
            adapterId: "bank-statements",
            webId: ownerWebId,
            profileDocumentUrl: TEST_PROFILE_DOC,
            podRoot: root,
            fetch,
            ...privacy,
          })
        : createStoragePodWriter({ storage, container, cleanupFetch: fetch, ...privacy });
    const slug = "file.bin";
    const url = writer.resolve(slug);
    const adapter = {
      ...bankStatementsFileAdapter,
      async importFile(
        _file: unknown,
        ctx: Parameters<typeof bankStatementsFileAdapter.importFile>[1],
      ) {
        await ctx.writeBinary({
          slug,
          contentType: "application/octet-stream",
          body: Uint8Array.of(3),
          mode: "replace",
        });
      },
    };
    const importBinary = () =>
      runFileImport({ adapter, file: memoryFile(slug, ""), podWriter: writer });
    await expect(importBinary()).rejects.toMatchObject({
      phase: "after-write",
      url,
      removed: true,
    });
    expect(pod.bytes(url)).toBeUndefined();
    await pod.fetch(url, { method: "PUT", body: Uint8Array.of(1) });
    await expect(importBinary()).rejects.toMatchObject({
      phase: "after-write",
      url,
      removed: false,
    });
    expect(pod.bytes(url)).toEqual(Uint8Array.of(3));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it.each([
    false,
    true,
  ])("keeps the existing session verifier factory callable (signal: %s)", async (cancellable) => {
    const { pod } = fixture();
    const controller = new AbortController();
    const verify = createSessionPrivateDestinationVerifier({
      fetch: pod.fetch,
      storageUrl: root,
      webId: ownerWebId,
      signal: cancellable ? controller.signal : undefined,
    });
    await expect(verify(target)).resolves.toBe(true);
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
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => ({ ...storage, ...mismatch }),
    });
    expect(await checks.verifyPrivateDestination(target)).toBe(false);
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
    expect(openStorage).toHaveBeenCalledTimes(1);
  });
});
