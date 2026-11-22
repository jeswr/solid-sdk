// AUTHORED-BY Codex GPT-6
import {
  ownerPolicy,
  createOwnerOnlyDestinationChecks as podAccessChecks,
  createOwnerOnlyDestinationVerifier as podAccessVerifier,
  writeWac,
} from "@jeswr/pod-access";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { MONZO } from "../bank-statements/fixtures.js";
import { garminAdapter } from "../garmin/adapter.js";
import {
  createOwnerOnlyDestinationChecks as publicChecks,
  createOwnerOnlyDestinationVerifier as publicVerifier,
} from "../index.js";
import { whoopAdapter } from "../whoop/adapter.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { createImportSession } from "./import-session.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { cleanupPrivateResource, requirePrivateWriteConfirmation } from "./pod-writer-policy.js";
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
        '"v1"',
      ),
    ).rejects.toMatchObject({ phase: "after-write", removed: false });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
  } finally {
    timeout.mockRestore();
  }
});

it("rejects a wildcard passed directly to cleanup without sending a DELETE", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(
    cleanupPrivateResource(fetch, `${TEST_POD_ROOT}refused.ttl`, {
      etag: "*",
      signal: new AbortController().signal,
    }),
  ).resolves.toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("redacts confirmation and cleanup errors and leaves later API writes and state blocked", async () => {
  const write = vi.fn<PodWriter["write"]>(async ({ slug, category, forClass }) => ({
    url: `${TEST_POD_ROOT}${slug}`,
    category,
    forClass,
    writeCreated: true,
    writeEtag: '"v1"',
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
      const first = await ctx
        .write({ ...doc, slug: "first.ttl" }, { ifNoneMatch: "*" })
        .catch((error) => error);
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
  expect(cleanupPrivateWrite).toHaveBeenCalledTimes(1);
  expect(registerType).not.toHaveBeenCalled();
  expect(onState).not.toHaveBeenCalled();
});

it("latches a refusal before cleanup and blocks mutations waiting on pre-write checks", async () => {
  const cleaning = Promise.withResolvers<void>();
  const cleaned = Promise.withResolvers<boolean>();
  const checking = Promise.withResolvers<void>();
  const checked = Promise.withResolvers<boolean>();
  const resolve = (slug: string) => new URL(slug, TEST_POD_ROOT).href;
  const preWriteChecks = new Set(["next.ttl", "next.bin", "_provenance.ttl"].map(resolve));
  const write = vi.fn<PodWriter["write"]>(async ({ slug, category, forClass }) => ({
    url: resolve(slug),
    category,
    forClass,
    writeCreated: true,
    writeEtag: '"v1"',
  }));
  const registerType = vi.fn<PodWriter["registerType"]>();
  const remove = vi.fn<NonNullable<PodWriter["remove"]>>();
  const writeBinary = vi.fn<NonNullable<PodWriter["writeBinary"]>>();
  const session = createImportSession(
    {
      resolve,
      read: async () => undefined,
      async verifyPrivateDestination(url) {
        if (!preWriteChecks.delete(url)) return true;
        if (preWriteChecks.size === 0) checking.resolve();
        return checked.promise;
      },
      confirmPrivateWrite: async () => false,
      cleanupPrivateWrite: () => {
        cleaning.resolve();
        return cleaned.promise;
      },
      write,
      writeBinary,
      registerType,
      remove,
    },
    "whoop",
    "urn:test:source",
    {},
  );
  try {
    const doc = { dataset: new Store(), category: "health", forClass: "urn:test:Health" };
    const next = session.write({ ...doc, slug: "next.ttl" }).catch((error) => error);
    const binary = session
      .writeBinary({
        slug: "next.bin",
        body: Uint8Array.of(1),
        contentType: "application/octet-stream",
      })
      .catch((error) => error);
    const finished = session.finish().catch((error) => error);
    await checking.promise;
    const first = session.write({ ...doc, slug: "first.ttl" }).catch((error) => error);
    await cleaning.promise;
    checked.resolve(true);
    const deletion = session.remove("old.ttl").catch((error) => error);
    const registration = session.registerTypes().catch((error) => error);
    await checked.promise;
    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(registerType).not.toHaveBeenCalled();
    cleaned.resolve(true);
    const refusal = await first;
    expect(refusal).toMatchObject({
      phase: "after-write",
      url: resolve("first.ttl"),
      removed: true,
    });
    expect(await next).toBe(refusal);
    expect(await binary).toBe(refusal);
    expect(await finished).toBe(refusal);
    expect(await deletion).toBe(refusal);
    expect(await registration).toBe(refusal);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeBinary).not.toHaveBeenCalled();
  } finally {
    session.release();
  }
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

it.each([
  "API",
  "file",
] as const)("waits for a refused private PUT after a concurrent %s failure", async (mode) => {
  const pod = createMemoryPod();
  const controller = new AbortController();
  const dispatched = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const cleaning = Promise.withResolvers<void>();
  const clean = Promise.withResolvers<void>();
  const reason = new Error("concurrent source failure");
  const podWriter = createFetchPodWriter({
    adapterId: mode === "API" ? "whoop" : "bank-statements",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    signal: controller.signal,
    verifyPrivateDestination: async () => true,
    confirmPrivateWrite: async () => false,
    async fetch(input, init) {
      if (init?.method === "PUT" && String(input) === payload) {
        dispatched.resolve();
        await acknowledge.promise;
      }
      if (init?.method === "DELETE" && String(input) === payload) {
        cleaning.resolve();
        await clean.promise;
      }
      return pod.fetch(input, init);
    },
  });
  const payload = podWriter.resolve("payload.ttl");
  async function importConcurrently(ctx: Pick<Parameters<typeof whoopAdapter.import>[0], "write">) {
    const write = ctx.write({
      slug: "payload.ttl",
      dataset: new Store(),
      category: "health",
      forClass: "urn:test:Health",
    });
    const fail = dispatched.promise.then(() => {
      if (mode === "API") controller.abort(reason);
      throw reason;
    });
    await Promise.all([write, fail]);
    return {};
  }
  const onState = vi.fn();
  const options = { podWriter, signal: controller.signal, onState };
  const run =
    mode === "API"
      ? runImport({
          ...options,
          adapter: { ...whoopAdapter, import: importConcurrently },
          mode: "demo",
        })
      : runFileImport({
          ...options,
          adapter: {
            ...bankStatementsFileAdapter,
            importFile: (_file, ctx) => importConcurrently(ctx),
          },
          file: memoryFile("bank.csv", ""),
        });
  const settled = vi.fn();
  const result = run.then(settled, (error) => {
    settled();
    return error;
  });
  try {
    await dispatched.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    acknowledge.resolve();
    await cleaning.promise;
    expect(settled).not.toHaveBeenCalled();
  } finally {
    acknowledge.resolve();
    clean.resolve();
  }
  expect(await result).toMatchObject({ phase: "after-write", url: payload, removed: true });
  expect(onState).not.toHaveBeenCalled();
});

describe("private writer confirmation", () => {
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
    const checks = createOwnerOnlyDestinationChecks({
      podRoot: root,
      ownerWebId,
      openStorage: () => storage,
    });
    const requests = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    return { pod, fetch, storage, checks, requests };
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
    ["weak write ETag with a strong first HEAD ETag", 'W/"v1"', 204, 404, true],
    ["completed DELETE", '"v1"', 200, 410, true],
    ["missing DELETE target", '"v1"', 404, 404, true],
    ["gone DELETE target", '"v1"', 410, 410, true],
    ["missing DELETE target still present", '"v1"', 404, 200, false],
    ["queued DELETE", '"v1"', 202, 404, false],
    ["reset-content DELETE", '"v1"', 205, 404, false],
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
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toBe('"v1"');
    expect(requests().slice(requests().indexOf(`DELETE ${payload}`))).toEqual(
      [200, 204, 404, 410].includes(deleteStatus)
        ? [`DELETE ${payload}`, `HEAD ${payload}`]
        : [`DELETE ${payload}`],
    );
    expect(pod.get(payload) === undefined).toBe(removed);
  });

  it.each([
    "fetch",
    "storage",
  ] as const)("never cleans up a queued create-only %s PUT", async (backend) => {
    const payload = `${container}finance/bank-transactions.ttl`;
    const { pod, fetch, storage, checks, requests } = fixture(async (url, init) => {
      if (url !== payload || init?.method !== "PUT") return;
      expect(new Headers(init.headers).get("if-none-match")).toBe("*");
      // Another writer stores the file before the queued request runs.
      await pod.fetch(url, { method: "PUT", body: "Concurrent file" });
      await seedPublicRead(pod.fetch, payload, false);
      return new Response(null, { status: 202 });
    });
    const podWriter =
      backend === "fetch"
        ? createFetchPodWriter({
            adapterId: "bank-statements",
            webId: ownerWebId,
            profileDocumentUrl: TEST_PROFILE_DOC,
            podRoot: root,
            fetch,
            ...checks,
          })
        : createStoragePodWriter({
            storage,
            container,
            webId: ownerWebId,
            cleanupFetch: fetch,
            ...checks,
          });
    await expect(
      runFileImport({
        adapter: bankStatementsFileAdapter,
        file: memoryFile("bank.csv", "Date,Description,Amount,Currency\n2026-06-01,Shop,-5.25,GBP"),
        podWriter,
      }),
    ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: false });
    expect(requests().slice(requests().indexOf(`PUT ${payload}`) + 1)).toContain(`HEAD ${payload}`);
    expect(requests().filter((request) => request.startsWith("DELETE "))).toEqual([]);
    expect(pod.get(payload)).toBe("Concurrent file");
  });

  it.each([
    "fetch",
    "storage",
  ] as const)("blocks a %s mutation already waiting for its ETag HEAD", async (backend) => {
    const preflight = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const cleaning = Promise.withResolvers<void>();
    const clean = Promise.withResolvers<void>();
    const payload = `${container}refused.ttl`;
    const { pod, storage, fetch, requests } = fixture(async (url, init) => {
      if (url === target && init?.method === "HEAD") {
        preflight.resolve();
        await resume.promise;
      }
      if (url === payload && init?.method === "DELETE") {
        cleaning.resolve();
        await clean.promise;
      }
    });
    const privacy = {
      verifyPrivateDestination: async () => true,
      confirmPrivateWrite: async () => false,
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
    await pod.fetch(target, { method: "PUT", body: "Earlier file" });
    const session = createImportSession(writer, "bank-statements", "urn:test:source", {});
    try {
      const waiting = (
        backend === "fetch"
          ? session.writeBinary({
              slug: "statement.ttl",
              body: Uint8Array.of(1),
              contentType: "application/octet-stream",
              mode: "replace",
            })
          : session.remove("statement.ttl")
      ).catch((error) => error);
      await preflight.promise;
      const refused = session
        .write({
          slug: "refused.ttl",
          dataset: new Store(),
          category: "money",
          forClass: "urn:test:Money",
        })
        .catch((error) => error);
      await cleaning.promise;
      resume.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requests()).not.toContain(`${backend === "fetch" ? "PUT" : "DELETE"} ${target}`);
      clean.resolve();
      const error = await refused;
      expect(error).toMatchObject({ phase: "after-write", url: payload, removed: true });
      expect(await waiting).toBe(error);
      expect(pod.get(target)).toBe("Earlier file");
    } finally {
      resume.resolve();
      clean.resolve();
      session.release();
    }
  });

  it.each([
    ["no validator anywhere", undefined, undefined],
    ["only weak validators", 'W/"v1"', 'W/"v1"'],
  ])("sends no DELETE for a refused create with %s", async (_case, writeEtag, headEtag) => {
    const payload = `${container}finance/bank-transactions.ttl`;
    const { pod, fetch, checks, requests } = fixture(async (url, init) => {
      if (url !== payload || !["PUT", "HEAD"].includes(init?.method ?? "")) return;
      const response = await pod.fetch(url, init);
      const etag = init?.method === "PUT" ? writeEtag : headEtag;
      if (etag === undefined) response.headers.delete("etag");
      else response.headers.set("etag", etag);
      return response;
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
    ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: false });
    expect(requests().at(-1)).toBe(`HEAD ${payload}`);
    expect(requests().some((request) => request.startsWith("DELETE "))).toBe(false);
    expect(pod.get(payload)).toBeDefined();
  });

  it.each([
    false,
    true,
  ])("uses the storage writer's actual mutation after an absent read (concurrent create: %s)", async (replacing) => {
    const { pod, storage, fetch, requests } = fixture();
    const verifyPrivateDestination = async (url: string) => {
      if (replacing) await pod.fetch(url, { method: "PUT", body: "" });
      return true;
    };
    const writer = createStoragePodWriter({
      storage,
      container,
      cleanupFetch: fetch,
      verifyPrivateDestination,
      confirmPrivateWrite: async () => false,
    });
    const session = createImportSession(writer, "bank-statements", "urn:test:source", {});
    try {
      await expect(session.read("statement.ttl")).resolves.toBeUndefined();
      await expect(
        session.write(
          {
            slug: "statement.ttl",
            dataset: new Store(),
            category: "money",
            forClass: "urn:test:Money",
          },
          {},
        ),
      ).rejects.toMatchObject({ phase: "after-write", url: target, removed: !replacing });
      const write = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
      const headers = new Headers(write?.[1]?.headers);
      expect(headers.get("if-match")).toBe(replacing ? '"v1"' : null);
      expect(headers.get("if-none-match")).toBe(replacing ? null : "*");
      expect(requests().some((request) => request.startsWith("DELETE "))).toBe(!replacing);
      expect(pod.get(target) !== undefined).toBe(replacing);
    } finally {
      session.release();
    }
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

  it.each([
    "fetch",
    "storage",
  ] as const)("confirms and cleans up a refused in-flight %s PUT after cancellation", async (backend) => {
    const controller = new AbortController();
    const onWriteAccepted = vi.fn();
    const payload = `${container}finance/bank-transactions.ttl`;
    const { pod, fetch, storage, checks } = fixture(async (url, init) => {
      if (url !== payload || init?.method !== "PUT") return;
      controller.abort(new Error("private cancellation reason"));
      init.signal?.throwIfAborted();
      const response = await pod.fetch(url, init);
      await seedPublicRead(pod.fetch, payload, false);
      return response;
    });
    const writer =
      backend === "storage"
        ? createStoragePodWriter({
            storage,
            container,
            webId: ownerWebId,
            cleanupFetch: fetch,
            ...checks,
            signal: controller.signal,
          })
        : createFetchPodWriter({
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
        podWriter: { ...writer, onWriteAccepted },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ phase: "after-write", url: payload, removed: true });
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deletion?.[1]?.signal?.aborted).toBe(false);
    expect(pod.get(payload)).toBeUndefined();
    expect(onWriteAccepted).not.toHaveBeenCalled();
  });

  it.each([
    "fetch",
    "storage",
  ] as const)("lets an in-flight private %s DELETE finish after cancellation", async (backend) => {
    const controller = new AbortController();
    const reason = new Error("cancelled during DELETE");
    const { pod, fetch, storage, checks } = fixture((url, init) => {
      if (url !== target || init?.method !== "DELETE") return;
      controller.abort(reason);
      init.signal?.throwIfAborted();
    });
    const signal = controller.signal;
    const writer =
      backend === "storage"
        ? createStoragePodWriter({ storage, container, signal, ...checks })
        : createFetchPodWriter({
            adapterId: "bank-statements",
            webId: ownerWebId,
            profileDocumentUrl: TEST_PROFILE_DOC,
            podRoot: root,
            fetch,
            signal,
          });
    const session = createImportSession(writer, "bank-statements", "urn:test:source", { signal });
    try {
      await pod.fetch(target, { method: "PUT", body: "" });
      await session.read("statement.ttl");
      await expect(session.remove("statement.ttl")).rejects.toBe(reason);
      expect(pod.get(target)).toBeUndefined();
    } finally {
      session.release();
    }
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

  it("exposes guarded container creation through the session verifier", async () => {
    const { pod, fetch, requests } = fixture();
    const verify = createSessionPrivateDestinationVerifier({
      fetch,
      storageUrl: root,
      webId: ownerWebId,
    });
    const refusal = new Error("The session refused further mutations");
    await expect(verify.beforeWrite?.(target, () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(requests().filter((request) => request.startsWith("PUT "))).toEqual([]);
    expect(pod.get(parent)).toBeUndefined();
  });
});

it("re-exports the shared pod-access checks through both connector entry points", () => {
  expect(publicChecks).toBe(podAccessChecks);
  expect(createOwnerOnlyDestinationChecks).toBe(podAccessChecks);
  expect(publicVerifier).toBe(podAccessVerifier);
  expect(createOwnerOnlyDestinationVerifier).toBe(podAccessVerifier);
});
