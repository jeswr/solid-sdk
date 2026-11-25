// AUTHORED-BY Claude Sonnet 5.5
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { describe, expect, it, vi } from "vitest";
import { syntheticFit } from "../../test/activity-fixtures.js";
import { type ImportFile, runFileImport } from "../core/file-import.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { requiresPrivateDestination } from "../core/pod-writer-policy.js";
import { createOwnerOnlyDestinationChecks } from "../core/private-destination.js";
import { createWacImportStorage } from "../core/storage-pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { activityFilesAdapter } from "./file-adapter.js";

const ID = "activity-files";
const container = `${TEST_POD_ROOT}integrations/${ID}/`;
const fitFile = (): ImportFile => ({
  name: "ride.fit",
  type: "application/octet-stream",
  size: syntheticFit().byteLength,
  stream: () => new Blob([syntheticFit()]).stream(),
});

function fixture(
  override?: (
    url: string,
    init?: RequestInit,
  ) => Response | undefined | Promise<Response | undefined>,
) {
  const pod = createMemoryPod();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (input, init) => (await override?.(String(input), init)) ?? pod.fetch(input, init),
  );
  const storage = createWacImportStorage({ root: TEST_POD_ROOT, fetch });
  const checks = createOwnerOnlyDestinationChecks({
    podRoot: TEST_POD_ROOT,
    ownerWebId: TEST_WEBID,
    openStorage: () => storage,
  });
  const writer = createFetchPodWriter({
    adapterId: ID,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch,
    ...checks,
  });
  const mutations = () =>
    fetch.mock.calls
      .map(([url, init]) => `${init?.method ?? "GET"} ${url}`)
      .filter((request) => /^(PUT|DELETE|POST|PATCH) /.test(request));
  return { pod, fetch, writer, mutations };
}

async function seedPublicRead(fetch: typeof globalThis.fetch, url: string, members: boolean) {
  const policy = ownerPolicy(TEST_WEBID, members);
  const [owner] = policy.grants;
  if (!owner) throw new Error("Expected an owner grant");
  policy.grants.push({ ...owner, modes: new Set(["read"]), who: [[{ kind: "public" }]] });
  await fetch(`${url}.acl`, { method: "PUT", body: await writeWac(policy, url, `${url}.acl`) });
}

describe("activity-files private-destination contract", () => {
  it("is classified private, like garmin and whoop", () => {
    for (const id of [ID, "garmin", "whoop"]) expect(requiresPrivateDestination(id)).toBe(true);
  });

  it.each([
    ["public-read destination", async () => false],
    ["unknown verdict", async () => undefined],
    ["non-boolean truthy verdict", async () => "yes"],
    [
      "unverifiable destination (verifier throws)",
      async () => {
        throw new Error("ACL unavailable");
      },
    ],
    ["no verifier", undefined],
  ] as const)("writes nothing with %s", async (_name, verify) => {
    const pod = createMemoryPod();
    const fetch = vi.fn(pod.fetch);
    const verifyPrivateDestination = verify && vi.fn(verify as () => Promise<boolean>);
    await expect(
      runFileImport({
        adapter: activityFilesAdapter,
        file: fitFile(),
        podWriter: createFetchPodWriter({
          adapterId: ID,
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch,
          verifyPrivateDestination: verifyPrivateDestination as never,
          confirmPrivateWrite: async () => true,
        }),
      }),
    ).rejects.toMatchObject({ name: "PrivateDestinationError", phase: "before-write" });
    if (verifyPrivateDestination) expect(verifyPrivateDestination).toHaveBeenCalled();
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(pod.putCount).toBe(0);
  });

  it.each([
    ["a public-read integrations container", `${TEST_POD_ROOT}integrations/`],
    ["a public-read connector container", container],
  ] as const)("refuses to write under %s that the destination inherits", async (_name, shared) => {
    const { pod, writer, mutations } = fixture();
    await seedPublicRead(pod.fetch, shared, true);
    await expect(
      runFileImport({ adapter: activityFilesAdapter, file: fitFile(), podWriter: writer }),
    ).rejects.toMatchObject({ name: "PrivateDestinationError", phase: "before-write" });
    expect(mutations().filter((request) => request.includes("/activities/"))).toEqual([]);
    expect(pod.urls().some((url) => url.includes("/activities/"))).toBe(false);
  });

  it("imports the activity, its FIT original and provenance when the destination is owner-only", async () => {
    const { pod, writer, mutations } = fixture();
    await expect(
      runFileImport({ adapter: activityFilesAdapter, file: fitFile(), podWriter: writer }),
    ).resolves.toMatchObject({ state: { lastOutcome: "success" } });
    expect(pod.urls().some((url) => /\/activities\/[a-f0-9]{64}\.ttl$/.test(url))).toBe(true);
    expect(mutations().some((request) => request.endsWith(".fit"))).toBe(true);
  });

  it.each([
    "planted ACL",
    "concurrent share",
  ] as const)("removes a created activity and reports an after-write refusal with a %s", async (policy) => {
    let sharedAt: string | undefined;
    const { pod, fetch, writer } = fixture(async (url, init) => {
      if (init?.method !== "PUT" || !/\/activities\/[a-f0-9]{64}\.ttl$/.test(url)) return;
      if (policy === "planted ACL") {
        await seedPublicRead(pod.fetch, url, false);
      } else {
        const folder = url.slice(0, url.lastIndexOf("/") + 1);
        await pod.fetch(`${url}.acl`, {
          method: "PUT",
          body: await writeWac(ownerPolicy(TEST_WEBID, false), url, `${url}.acl`),
        });
        await seedPublicRead(pod.fetch, folder, true);
      }
      sharedAt = url;
    });
    const registerType = vi.fn(async () => ({ indexUrl: "" }));
    const onState = vi.fn();
    const refusal = await runFileImport({
      adapter: activityFilesAdapter,
      file: fitFile(),
      podWriter: { ...writer, registerType },
      onState,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(sharedAt).toBeDefined();
    expect(refusal).toMatchObject({
      name: "PrivateDestinationError",
      phase: "after-write",
      url: sharedAt,
      removed: true,
    });
    expect(registerType).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
    expect((await pod.fetch(sharedAt as string)).status).toBe(404);
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toMatch(/^"/);
  });

  it("lets cancellation win over a refusal and sends no write", async () => {
    const pod = createMemoryPod();
    const signal = AbortSignal.abort(new Error("cancelled"));
    await expect(
      runFileImport({
        adapter: activityFilesAdapter,
        file: fitFile(),
        signal,
        podWriter: createFetchPodWriter({
          adapterId: ID,
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch: pod.fetch,
          verifyPrivateDestination: async () => false,
          confirmPrivateWrite: async () => false,
        }),
      }),
    ).rejects.toThrow("cancelled");
    expect(pod.putCount).toBe(0);
  });
});
