// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type {
  MountEngine,
  SheetEngine,
  Snapshot,
  WorkbookService,
} from "../src/apps/sheets/lib/contract";
import { act, click, h, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";

const mocks = vi.hoisted(() => ({
  service: null as WorkbookService | null,
  mount: vi.fn<MountEngine>(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children, actions }: { children: ReactNode; actions: ReactNode }) =>
    h("main", {}, actions, children),
}));
vi.mock("../src/apps/sheets/state/service", () => ({ useWorkbookService: () => mocks.service }));
vi.mock("../src/apps/sheets/lib/engine", () => ({ loadEngine: async () => mocks.mount }));

import { SheetEditor } from "../src/apps/sheets/components/sheet-editor";
import { readCharts } from "../src/apps/sheets/lib/charts/spec";

function button(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function waitForUi(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(() => {});
      check();
    },
    { timeout: 10_000 },
  );
}
async function flush() {
  await act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

it("autosaves chart insert, source edits and deletion through SheetEditor, then reloads from the pod", async () => {
  vi.stubGlobal("matchMedia", window.matchMedia);
  const harn = await harness();
  mocks.service = harn.service;
  const book = await harn.service.create({
    title: "Chart flow",
    snapshot: snapshot("Month,Value\nJan,10\nFeb,20"),
  });
  let data: Snapshot = book.snapshot;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  mocks.mount.mockImplementation(async (_host, options) => {
    data = options.snapshot;
    return {
      snapshot: () => data,
      load: (value) => {
        data = value;
      },
      onChange: subscribe,
      onValuesChange: subscribe,
      setCharts: (charts) => {
        data = { ...data, charts };
        notify();
      },
      selection: () => ({ sheetId: "data", range: "A1:B3" }),
      activeSheet: () => ({ id: "data", name: "Data" }),
      exportCsv: () => "",
      importCsv: vi.fn(),
      setDark: vi.fn(),
      setReadOnly: vi.fn(),
      dispose: vi.fn(),
    } satisfies SheetEngine;
  });
  let ui = await mount(h(SheetEditor, { container: book.container }));
  await waitForUi(() => expect(button("Insert chart").disabled).toBe(false));
  await click(button("Insert chart"));
  const title = document.querySelector<HTMLInputElement>(
    '.sht-chart-editor input[maxlength="200"]',
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      title,
      "Monthly revenue",
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    document
      .querySelector(".sht-chart-editor form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
  await vi.waitFor(async () => {
    expect(readCharts((await harn.service.open(book.container)).snapshot).charts[0]?.title).toBe(
      "Monthly revenue",
    );
  });
  // A real engine user mutation schedules the same save path as setCharts.
  await act(() => {
    data = {
      ...data,
      sheets: {
        data: {
          ...(data.sheets as Record<string, Snapshot>).data,
          cellData: {
            0: { 0: { v: "Month" }, 1: { v: "Value" } },
            1: { 0: { v: "Jan" }, 1: { v: 99 } },
          },
        },
      },
    };
    notify();
  });
  expect(document.querySelector("svg desc")?.textContent).toContain("99 to 99");
  await flush();
  await vi.waitFor(async () => {
    const reopened = await harn.service.open(book.container);
    expect(reopened.snapshot.sheets).toEqual(data.sheets);
    expect(readCharts(reopened.snapshot).charts).toHaveLength(1);
  });
  await ui.unmount();
  expect(listeners.size).toBe(0);
  ui = await mount(h(SheetEditor, { container: book.container }));
  await waitForUi(() =>
    expect(document.querySelector("svg title")?.textContent).toBe("Monthly revenue"),
  );
  await click(button("Edit chart"));
  await click(button("Delete chart"));
  await flush();
  await vi.waitFor(async () =>
    expect(readCharts((await harn.service.open(book.container)).snapshot).charts).toEqual([]),
  );
  await ui.unmount();
  ui = await mount(h(SheetEditor, { container: book.container }));
  await waitForUi(() => expect(button("Insert chart").disabled).toBe(false));
  expect(document.querySelector('svg[role="img"]')).toBeNull();
  await ui.unmount();
});
