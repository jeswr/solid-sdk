// AUTHORED-BY Claude Sonnet 5.5
// An item that arrived as an inbox announcement stays preview-only once opened, and Drive's
// Shared view never requests an announced URL on its own.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  client: { list: vi.fn(), stat: vi.fn(), createFolder: vi.fn() },
}));
vi.mock("../src/apps/drive/lib/client/client", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/client/client")>()),
  createSolidDriveClient: () => mocks.client,
}));
vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useParams: () => ({ ref: "" }),
  usePathname: () => "/drive/shared",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { FolderView, SharedView } from "../src/apps/drive/components/views";
import { DriveProvider } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider } from "../src/apps/drive/state/ui";

const ROOT = "https://pod.example/alice/";
const SENDER = "https://bob.example/pod/";
const session: PodSession = {
  mode: "demo",
  webId: `${ROOT}profile/card#me`,
  storageUrl: ROOT,
  displayName: "Alice",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: vi.fn(),
};
const prefsKey = `suite.drive.prefs.${session.webId}`;
const wrap = (child: ReturnType<typeof h>) =>
  h(DriveProvider, { session, children: h(DriveUiProvider, null, child) });
const stored = (): { url: string; announced?: boolean }[] =>
  JSON.parse(localStorage.getItem(prefsKey) ?? '{"openedShared":[]}').openedShared;

beforeEach(() => {
  localStorage.clear();
  mocks.client.list.mockResolvedValue([]);
  mocks.client.stat.mockImplementation(async (url: string) => ({
    url,
    name: "x",
    kind: url.endsWith("/") ? "folder" : "file",
  }));
});
afterEach(() => {
  vi.stubGlobal("location", undefined);
  vi.clearAllMocks();
});

async function open(url: string, search: string) {
  vi.stubGlobal("location", { search });
  const view = await mount(wrap(h(FolderView, { url })));
  await view.unmount();
}

it("records the announcement on the opened entry when the preview came from an announced row", async () => {
  await open(`${SENDER}shared/`, "?from=announced");
  expect(stored()).toEqual([expect.objectContaining({ url: `${SENDER}shared/`, announced: true })]);
});

it("does not mark an open that did not come from an announcement", async () => {
  await open(`${SENDER}shared/`, "");
  expect(stored()[0]).not.toHaveProperty("announced");
});

it("keeps the announcement when the same URL is opened again without the marker", async () => {
  await open(`${SENDER}shared/`, "?from=announced");
  await open(`${SENDER}shared/`, "");
  expect(stored()).toHaveLength(1);
  expect(stored()[0]).toMatchObject({ announced: true });
});

it("the Shared view requests an opened URL on its own only if it was not announced", async () => {
  localStorage.setItem(
    prefsKey,
    JSON.stringify({
      openedShared: [
        { url: `${SENDER}announced.txt`, openedAt: "2026-10-28T10:00:00Z", announced: true },
        { url: `${SENDER}announced-old.txt`, openedAt: "2026-10-27T10:00:00Z", announced: true },
        { url: `${SENDER}announced-old.txt`, openedAt: "2026-10-28T10:00:00Z" },
        { url: `${SENDER}pasted.txt`, openedAt: "2026-10-26T10:00:00Z" },
      ],
    }),
  );
  const view = await mount(wrap(h(SharedView)));
  const requested = mocks.client.stat.mock.calls.map(([url]) => url);
  expect(requested).toEqual([`${SENDER}pasted.txt`]);
  // The announced rows are still listed, from the stored metadata.
  expect(view.host.querySelectorAll("[data-url]")).toHaveLength(3);
  await view.unmount();
});
