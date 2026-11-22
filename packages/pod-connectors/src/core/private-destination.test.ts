// AUTHORED-BY Codex GPT-6
import {
  ownerPolicy,
  createOwnerOnlyDestinationVerifier as podAccessVerifier,
  writeWac,
} from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { MONZO } from "../bank-statements/fixtures.js";
import { garminAdapter } from "../garmin/adapter.js";
import { createOwnerOnlyDestinationVerifier as publicVerifier } from "../index.js";
import { whoopAdapter } from "../whoop/adapter.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createOwnerOnlyDestinationVerifier } from "./private-destination.js";
import { createWacImportStorage } from "./storage-pod-writer.js";
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
    const { pod, fetch, verify, requests } = fixture(async (url, init) => {
      if (url === payload && init?.method === "PUT" && policy === "concurrent share")
        await seedPublicRead(pod.fetch, folder, true);
    });
    if (policy === "planted ACL") await seedPublicRead(pod.fetch, payload, false);
    const writer = createFetchPodWriter({
      adapterId: "bank-statements",
      webId: ownerWebId,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: root,
      fetch,
      verifyPrivateDestination: verify,
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
      await expect(importing).rejects.toMatchObject({ name: "PrivateDestinationError" });
      expect(registerType).not.toHaveBeenCalled();
      expect(onState).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ lastOutcome: "error" }),
      );
      expect(mutations().slice(-2)).toEqual([`PUT ${payload}`, `DELETE ${payload}`]);
      const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(new Headers(deletion?.[1]?.headers).get("if-match")).toBe('"v1"');
      expect((await pod.fetch(payload)).status).toBe(404);
      expect(pod.get(provenance)).toBeUndefined();
    }
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

it("keeps the connector public export and CLI shim wired to pod-access", () => {
  expect(publicVerifier).toBe(podAccessVerifier);
  expect(createOwnerOnlyDestinationVerifier).toBe(podAccessVerifier);
});
