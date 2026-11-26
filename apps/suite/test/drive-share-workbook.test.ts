// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Claude Opus 5.5
// Drive's Share on a Sheets workbook never opens the per-scope editor (Int9 review F12).
import { Fragment } from "react";
import { expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
}));
const { shown } = vi.hoisted(() => ({
  shown: [] as { url: string; scopedEditor?: boolean | undefined }[],
}));
vi.mock("../src/apps/drive/components/share-dialog", () => ({
  ShareDialog: (props: { item: { url: string }; scopedEditor?: boolean }) => {
    shown.push({ url: props.item.url, scopedEditor: props.scopedEditor });
    return null;
  },
}));

import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { DriveProvider } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveUi } from "../src/apps/drive/state/ui";

let ui: ReturnType<typeof useDriveUi>;
function Dialogs() {
  ui = useDriveUi();
  return h(Fragment, null, h(DriveDialogs));
}

it("opens Drive's Share on a workbook without the per-scope editor", async () => {
  const f = await rdfPod();
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  await mount(h(DriveProvider, { session, children: h(DriveUiProvider, null, h(Dialogs)) }));
  const folder: DriveItem = { kind: "folder", url: `${PRIVATE}drop/`, name: "drop" };
  const items: [DriveItem, boolean][] = [
    [folder, true],
    [{ ...folder, url: `${PRIVATE}sheets/budget/`, workbook: true }, false],
    [{ ...folder, url: `${PRIVATE}sheets/unread/`, workbookUnknown: true }, false],
  ];
  for (const [item, scopedEditor] of items) {
    await act(async () => ui.openDialog({ kind: "share", item }));
    expect(shown.at(-1)).toEqual({ url: item.url, scopedEditor });
    await act(async () => ui.closeDialog());
  }
});
