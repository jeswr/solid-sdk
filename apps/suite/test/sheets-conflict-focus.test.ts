// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type { useWorkbook } from "../src/apps/sheets/hooks/use-workbook";
import { act, click, h, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof useWorkbook> | null,
  engine: {
    load: vi.fn(),
    snapshot: vi.fn(),
    onChange: () => () => {},
    setDark: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    children,
    context,
    actions,
  }: {
    children: ReactNode;
    context: ReactNode;
    actions: ReactNode;
  }) => h("main", null, context, actions, children),
}));
vi.mock("../src/apps/sheets/state/service", () => ({ useWorkbookService: () => ({}) }));
vi.mock("../src/apps/sheets/hooks/use-workbook", () => ({ useWorkbook: () => mocks.state }));
vi.mock("../src/apps/sheets/lib/engine", () => ({
  loadEngine: async () => async () => mocks.engine,
}));
vi.mock("../src/apps/sheets/components/sheets-sidebar", () => ({
  SheetsSidebar: () => null,
  workbookHref: () => "/sheets",
}));

import { SheetEditor } from "../src/apps/sheets/components/sheet-editor";

it("focuses Load their version on conflict and restores focus to File after resolution", async () => {
  const pod = await harness();
  const book = await pod.service.create({ title: "Focus", snapshot: snapshot() });
  const reload = vi.fn(async () => {
    if (mocks.state) mocks.state.status = "saved";
    return book.snapshot;
  });
  mocks.state = {
    workbook: book,
    metadata: book.metadata,
    version: book.version,
    error: undefined,
    status: "saved",
    scheduleSave: vi.fn(),
    rename: vi.fn(),
    reload,
    retry: vi.fn(),
    flush: vi.fn(),
    discard: vi.fn(),
    retryOpen: vi.fn(),
  };
  vi.stubGlobal("matchMedia", window.matchMedia);
  const editor = await mount(h(SheetEditor, { container: book.container }));
  const file = editor.host.querySelector<HTMLButtonElement>(".sht-file-trigger");
  const fileButton =
    file ??
    [...editor.host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "File",
    );
  expect(fileButton).toBeDefined();
  await act(() => fileButton?.focus());
  mocks.state.status = "conflict";
  await editor.render(h(SheetEditor, { container: book.container }));
  expect(document.activeElement?.textContent).toBe("Load their version");
  const load = document.activeElement;
  if (!load) throw new Error("Conflict dialog has no focused control");
  await click(load);
  expect(reload).toHaveBeenCalledOnce();
  expect(mocks.engine.load).toHaveBeenCalledWith(book.snapshot);
  await vi.waitFor(() => expect(document.activeElement).toBe(fileButton));
  await editor.unmount();
});
