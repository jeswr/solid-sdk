// AUTHORED-BY Codex GPT-6.1-Sol

import { NS } from "@jeswr/suite-vocab";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), index: vi.fn(), find: vi.fn() }));
vi.mock("@jeswr/storage-client", () => ({ createPodClient: mocks.client }));
vi.mock("@jeswr/pod-type-index", () => ({ createTypeIndex: mocks.index }));

import { createDemoPod } from "../src/lib/demo-pod/pod";
import { exportApps, exportRootFolders } from "../src/shell/settings/export-apps";

const root = "https://pod.example/alice/";
beforeEach(() => {
  mocks.client.mockReset().mockResolvedValue({ storage: {}, features: {} });
  mocks.index.mockReset().mockReturnValue({ findAll: mocks.find });
  mocks.find.mockReset().mockResolvedValue(new Map());
});
it("uses the SDK Type Index and scopes registration hints", async () => {
  mocks.find.mockResolvedValue(
    new Map([
      [
        `${NS.POD_DOCS}Document`,
        [`${root}docs/#this`, "https://evil.example/foreign", `${root}docs/?q`],
      ],
    ]),
  );
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response());
  const result = await exportApps(
    fetch,
    root,
    `${root}profile/card#me`,
    new AbortController().signal,
  );
  expect(result).toEqual([{ url: `${root}docs/`, label: "Docs — /alice/docs/" }]);
  const transport = mocks.client.mock.calls[0]?.[0].fetch as typeof globalThis.fetch;
  await expect(transport("https://evil.example/foreign")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await transport(`${root}docs/`);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
});
it("tolerates absent registrations and propagates unavailable indexes/cancellation to the optional UI seam", async () => {
  expect(
    await exportApps(vi.fn(), root, `${root}profile/card#me`, new AbortController().signal),
  ).toEqual([]);
  mocks.find.mockRejectedValueOnce(new Error("index denied"));
  await expect(
    exportApps(vi.fn(), root, `${root}profile/card#me`, new AbortController().signal),
  ).rejects.toThrow("index denied");
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportApps(vi.fn(), root, `${root}profile/card#me`, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("lists root folders independently of inventory and tolerates a missing root", async () => {
  const pod = createDemoPod({
    root,
    seed: [{ path: "docs/hello", body: "hello", contentType: "text/plain" }],
  });
  expect(await exportRootFolders(pod.fetch, root, new AbortController().signal)).toEqual([
    { url: `${root}docs/`, label: "docs/" },
  ]);
  expect(
    await exportRootFolders(
      async () => new Response(null, { status: 404 }),
      root,
      new AbortController().signal,
    ),
  ).toEqual([]);
});

it("handles Request discovery inputs and refuses a foreign successful response URL", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  await exportApps(fetch, root, `${root}profile/card#me`, new AbortController().signal);
  const transport = mocks.client.mock.calls[0]?.[0].fetch as typeof globalThis.fetch;
  await transport(new Request(`${root}docs/`));
  expect(fetch.mock.calls[0]?.[0]).toBe(`${root}docs/`);
  const cancelled = vi.fn();
  fetch.mockResolvedValueOnce(
    Object.defineProperty(new Response(new ReadableStream({ cancel: cancelled })), "url", {
      value: "https://foreign.example/private",
    }),
  );
  await expect(transport(new Request(`${root}docs/`))).rejects.toThrow();
  expect(cancelled).toHaveBeenCalled();
});
