// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import { act, h, mount } from "./drive-ui-dom";

const share = vi.hoisted(() => ({ props: undefined as { notice?: unknown } | undefined }));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: {} }),
}));
vi.mock("../src/shell/share", () => ({
  ShareDialog: (props: { notice?: unknown }) => {
    share.props = props;
    return null;
  },
  wacShareCapabilities: {},
}));
vi.mock("../src/apps/sheets/lib/sharing", () => ({ WorkbookSharingAdapter: class {} }));
vi.mock("../src/apps/sheets/components/sheets-sidebar", () => ({
  workbookHref: () => "/sheets/x",
}));

import { SHARE_HISTORY_NOTICE, ShareWorkbook } from "../src/apps/sheets/components/share-workbook";

it("tells the owner that people with access can see earlier versions and past edits", async () => {
  const ui = await mount(
    h(ShareWorkbook, { container: "https://pod.example/sheets/x/", title: "X", onClose: vi.fn() }),
  );
  await act(async () => {});
  expect(share.props?.notice).toBe(SHARE_HISTORY_NOTICE);
  expect(SHARE_HISTORY_NOTICE).toMatch(/earlier versions and past edits/);
  await ui.unmount();
});
