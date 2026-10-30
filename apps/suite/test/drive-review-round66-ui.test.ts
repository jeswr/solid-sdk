// AUTHORED-BY Codex
import { Fragment } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  type DriveClient,
  type DriveItem,
} from "../src/apps/drive/lib/client/client";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

const mocks = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => drive }));

import { DetailsPane } from "../src/apps/drive/components/details";
import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";

let ui: ReturnType<typeof useDriveUi>;
let actions: ReturnType<typeof useDriveActions>;
const drive = {
  client: undefined as unknown as DriveClient,
  driveRoot: DRIVE,
  prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
  updatePrefs: vi.fn(),
  uploads: { tasks: [], enqueue: vi.fn() },
  invalidate: vi.fn(),
  changes: { subscribe: () => () => {}, subscribeSubtree: () => () => {} },
  session: { storageUrl: ROOT, webId: OWNER, fetch: undefined as unknown as typeof fetch },
};

function Probe() {
  ui = useDriveUi();
  actions = useDriveActions();
  return ui.detailsOpen ? h(DetailsPane, { onClose: () => ui.setDetailsOpen(false) }) : null;
}
function tree(items: DriveItem[], folder = PRIVATE) {
  return h(
    DriveUiProvider,
    null,
    h(
      Fragment,
      null,
      h(Probe),
      h(FileBrowser, {
        title: "Files",
        items,
        folder,
        columns: [],
        empty: { title: "Empty", icon: null },
      }),
      h(DriveDialogs),
    ),
  );
}
afterEach(() => vi.restoreAllMocks());

it("round 66: multi-selection Details reconciles replacement sizes with unchanged selected URLs", async () => {
  const f = await rdfPod();
  await f.pod.fetch(`${PRIVATE}secret`, { method: "PUT", body: "1234567890" });
  await f.pod.fetch(`${PRIVATE}other`, { method: "PUT", body: "1234567890" });
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  drive.session.fetch = f.fetch;
  const view = await mount(tree(await drive.client.list(PRIVATE)));
  const secret = view.host.querySelector(`[data-url="${PRIVATE}secret"]`);
  const other = view.host.querySelector(`[data-url="${PRIVATE}other"]`);
  if (!secret || !other) throw new Error("Missing rows");
  await click(secret);
  await act(async () => {
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  });
  await act(async () => ui.setDetailsOpen(true));
  expect(view.host.querySelector(".drv-details")?.textContent).toContain("20 B");
  await uploadFile(
    drive.client,
    PRIVATE,
    new Blob(["x".repeat(10000)]),
    "secret",
    "replace",
    await drive.client.stat(`${PRIVATE}secret`),
  );
  await view.render(tree(await drive.client.list(PRIVATE)));
  expect(ui.detailsItems.find((item) => item.url === `${PRIVATE}secret`)?.size).toBe(10000);
  expect(view.host.querySelector(".drv-details")?.textContent).toContain("10 kB");
});

it.each([
  { operation: "rename", selected: false },
  { operation: "move", selected: false },
  { operation: "rename", selected: true },
] as const)("round 66: Details follows successful $operation (selected: $selected)", async ({
  operation,
  selected,
}) => {
  const f = await rdfPod();
  const target = `${PRIVATE}target/`;
  await f.pod.fetch(target, { method: "PUT", body: "" });
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  drive.session.fetch = f.fetch;
  const view = await mount(tree(await drive.client.list(PRIVATE)));
  const row = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}secret"]`);
  if (!row) throw new Error("Missing row");
  await act(async () => row.focus());
  if (selected) await click(row);
  await key(row, "d");
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you"),
  );
  const item = await drive.client.stat(`${PRIVATE}secret`);
  await act(async () => {
    if (operation === "rename") await actions.rename(item, "renamed");
    else await actions.move([item], target);
  });
  await view.render(tree(await drive.client.list(PRIVATE)));
  const destination = operation === "rename" ? `${PRIVATE}renamed` : `${target}secret`;
  expect(f.pod.has(item.url)).toBe(false);
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([destination]);
  expect(view.host.querySelector(".drv-details h2")?.textContent).toBe(
    operation === "rename" ? "renamed" : "secret",
  );
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you"),
  );
  const technical = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Show technical details",
  );
  if (!technical) throw new Error("Missing technical disclosure");
  await click(technical);
  expect(view.host.querySelector(".drv-address")?.textContent).toContain(destination);
  expect(view.host.querySelector(".drv-details")?.textContent).not.toContain(item.url);
});
