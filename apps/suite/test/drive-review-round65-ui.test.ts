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
import { useItemMenu } from "../src/apps/drive/components/item-menu";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";

let ui: ReturnType<typeof useDriveUi>;
let details: (() => void) | undefined;
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

function Probe({ items }: { items: DriveItem[] }) {
  ui = useDriveUi();
  const menu = useItemMenu(useDriveActions(), items.slice(0, 1), items);
  details = menu.flatMap((entry) =>
    entry !== "separator" && entry.id === "details" ? [entry.onSelect] : [],
  )[0];
  return ui.detailsOpen ? h(DetailsPane, { onClose: () => ui.setDetailsOpen(false) }) : null;
}
function tree(items: DriveItem[], folder = PRIVATE) {
  return h(
    DriveUiProvider,
    null,
    h(
      Fragment,
      null,
      h(Probe, { items }),
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

it.each([
  "keyboard",
  "item menu",
])("round 65: Details opened by %s on an unselected file survives an upload listing refresh", async (opener) => {
  const f = await rdfPod();
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  drive.session.fetch = f.fetch;
  const items = await drive.client.list(PRIVATE);
  const view = await mount(tree(items));
  const row = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}secret"]`);
  if (!row) throw new Error("Missing file");
  await act(async () => row.focus());
  if (opener === "keyboard") await key(row, "d");
  else await act(async () => details?.());
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you"),
  );
  expect(row.getAttribute("aria-selected")).not.toBe("true");
  await uploadFile(drive.client, PRIVATE, new Blob(["new file"]), "another.txt");
  await view.render(tree(await drive.client.list(PRIVATE)));
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([`${PRIVATE}secret`]);
  expect(view.host.querySelector(".drv-details h2")?.textContent).toBe("secret");
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you");
  expect(view.host.textContent).not.toContain("Select an item to see its details");
  // An actual selection change still takes ownership of Details, including clearing it.
  const another = view.host.querySelector<HTMLElement>(`[data-url="${PRIVATE}another.txt"]`);
  if (!another) throw new Error("Missing upload");
  await click(another);
  expect(ui.detailsItems.map(({ url }) => url)).toEqual([`${PRIVATE}another.txt`]);
  await key(another, "Escape");
  expect(ui.detailsItems).toEqual([]);
});

it.each([
  "parent",
  "root",
])("round 65: collapsing the %s of the selected Move descendant retargets its sole Tab stop and focus", async (ancestor) => {
  const f = await rdfPod();
  const parent = `${DRIVE}Parent/`;
  const child = `${parent}Child/`;
  await f.pod.fetch(child, { method: "PUT", body: "" });
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  drive.session.fetch = f.fetch;
  await mount(tree(await drive.client.list(PRIVATE)));
  await act(async () =>
    ui.openDialog({ kind: "move", items: [await drive.client.stat(`${PRIVATE}secret`)] }),
  );
  await vi.waitFor(() => expect(document.querySelector(`[data-node="${parent}"]`)).not.toBeNull());
  const expand = document.querySelector('[aria-label="Expand Parent"]');
  if (!expand) throw new Error("Missing parent disclosure");
  await click(expand);
  await vi.waitFor(() => expect(document.querySelector(`[data-node="${child}"]`)).not.toBeNull());
  const descendant = document.querySelector<HTMLElement>(`[data-node="${child}"]`);
  if (!descendant) throw new Error("Missing child");
  await click(descendant);
  await act(async () => descendant.focus());
  const url = ancestor === "parent" ? parent : DRIVE;
  const collapse = document.querySelector(`[data-node="${url}"] > .drv-tree-row > button`);
  if (!collapse) throw new Error("Missing ancestor disclosure");
  await click(collapse);
  const node = document.querySelector<HTMLElement>(`[data-node="${url}"]`);
  await vi.waitFor(() => expect(document.activeElement).toBe(node));
  expect(document.querySelector(`[data-node="${child}"]`)).toBeNull();
  expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  expect(node?.getAttribute("aria-selected")).toBe("true");
  expect(node?.tabIndex).toBe(0);
  await key(node as Element, "ArrowRight");
  await vi.waitFor(() => expect(document.querySelector(`[data-node="${child}"]`)).not.toBeNull());
});
