// AUTHORED-BY Codex GPT-6
import type { StorageClient } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, it, vi } from "vitest";
import { createOwnerOnlyDestinationVerifier, ownerPolicy, writeWac } from "./index.js";

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
