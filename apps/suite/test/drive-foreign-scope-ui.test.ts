// AUTHORED-BY Claude Sonnet 5.5
// Which transport Drive's preview client uses: the signed-in session only inside the storage.
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  created: Array.from<{ fetch: typeof fetch }>([]),
  client: { list: vi.fn(async () => []), stat: vi.fn(), createFolder: vi.fn() },
}));
vi.mock("../src/apps/drive/lib/client/client", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/client/client")>()),
  createSolidDriveClient: (options: { fetch: typeof fetch }) => {
    mocks.created.push(options);
    return mocks.client;
  },
}));
vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));

import { DriveProvider, ForeignPreviewScope } from "../src/apps/drive/state/drive-context";

const MINE = "https://pod.example/alice/";
const sessionFetch = vi.fn<typeof fetch>(async () => new Response("mine"));
const session: PodSession = {
  mode: "demo",
  webId: `${MINE}profile#me`,
  storageUrl: MINE,
  displayName: "Alice",
  fetch: sessionFetch,
  subscribe: () => () => {},
  reset: vi.fn(),
};
const globalFetch = vi.fn<typeof fetch>(async () => new Response("theirs"));
const realFetch = globalThis.fetch;
afterEach(() => {
  mocks.created.length = 0;
  vi.stubGlobal("fetch", realFetch);
  vi.clearAllMocks();
});

async function scope(url: string) {
  vi.stubGlobal("fetch", globalFetch);
  const view = await mount(
    h(DriveProvider, { session, children: h(ForeignPreviewScope, { url, children: h("p") }) }),
  );
  const created = [...mocks.created];
  await view.unmount();
  return created;
}

it("uses the session transport only inside the storage for a foreign preview", async () => {
  const created = await scope("https://bob.example/pod/doc.ttl");
  expect(created).toHaveLength(2);
  const foreign = created[1]?.fetch as typeof fetch;
  sessionFetch.mockClear();
  await foreign(`${MINE}inside.txt`);
  expect(sessionFetch).toHaveBeenCalledTimes(1);
  await foreign("https://bob.example/pod/doc.ttl", { headers: { authorization: "DPoP t" } });
  await foreign("https://pod.example/alice-other/x");
  expect(sessionFetch).toHaveBeenCalledTimes(1);
  expect(globalFetch.mock.calls.map(([input]) => String(input))).toEqual([
    "https://bob.example/pod/doc.ttl",
    "https://pod.example/alice-other/x",
  ]);
  for (const [, init] of globalFetch.mock.calls) {
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  }
});

it("keeps the account's own client for a resource inside the storage", async () => {
  const created = await scope(`${MINE}docs/a.ttl`);
  expect(created).toHaveLength(1);
  expect(created[0]?.fetch).toBe(sessionFetch);
});
