// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MountEngine, SheetEngine, Snapshot } from "../src/apps/sheets/lib/contract";
import type { SheetVersion, VersionHistory } from "../src/apps/sheets/lib/versions";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { snapshot } from "./sheets-workbook-helpers";

const mocks = vi.hoisted(() => ({ mount: vi.fn<MountEngine>() }));
vi.mock("../src/apps/sheets/lib/engine", () => ({ loadEngine: async () => mocks.mount }));

const { SheetVersionHistory, VersionPreview } = await import(
  "../src/apps/sheets/components/version-history"
);

function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function versionButton() {
  const found = document.querySelector<HTMLButtonElement>(
    '[aria-label="Spreadsheet versions"] button',
  );
  if (!found) throw new Error("Missing version");
  return found;
}
async function fillName(name: string) {
  const field = document.querySelector("input");
  if (!field) throw new Error("Missing name field");
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      field,
      name,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submitName() {
  await act(() =>
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function fixture(readOnly = false, namingCurrent = false) {
  const version: SheetVersion = {
    url: "https://pod.example/book/versions/one.meta.json",
    created: "2026-11-01T10:00:00Z",
    author: "https://pod.example/alice#me",
    etag: '"v1"',
  };
  const data = snapshot();
  const history = {
    list: vi.fn(async () => [version]),
    load: vi.fn(async () => data),
    name: vi.fn(async () => {}),
    capture: vi.fn(async () => {}),
  } satisfies VersionHistory;
  const props = {
    history,
    readOnly,
    namingCurrent,
    prepare: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    close: vi.fn(),
  };
  return { version, data, props, history };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mount.mockImplementation(async () => ({ dispose: vi.fn() }) as unknown as SheetEngine);
});
afterEach(() => vi.restoreAllMocks());

it("lists times, names and authors and previews with a separate read-only engine", async () => {
  const f = fixture();
  const ui = await mount(h(SheetVersionHistory, f.props));
  expect(versionButton().textContent).toContain("Automatic version");
  expect(versionButton().querySelector("time")?.dateTime).toBe(f.version.created);
  expect(versionButton().textContent).toContain(f.version.author);
  await click(versionButton());
  expect(f.history.load).toHaveBeenCalledWith(f.version.url);
  expect(mocks.mount).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({ snapshot: f.data, readOnly: true, compact: true }),
  );
  const preview = await mocks.mount.mock.results[0]?.value;
  expect(document.querySelector('[aria-label="Version preview"]')).not.toBeNull();
  await ui.unmount();
  expect(preview?.dispose).toHaveBeenCalledOnce();
});

it("confirms restore, supports cancel, and leaves failures available for retry", async () => {
  const f = fixture();
  f.props.restore.mockRejectedValueOnce(new Error("Conflict"));
  await mount(h(SheetVersionHistory, f.props));
  await click(versionButton());
  await click(button("Restore this version"));
  expect(f.props.restore).not.toHaveBeenCalled();
  expect(document.querySelector("fieldset")?.textContent).toContain(
    "saved in version history first",
  );
  await click(button("Cancel"));
  expect(document.querySelector("fieldset")).toBeNull();
  await click(button("Restore this version"));
  await click(button("Restore"));
  expect(f.props.restore).toHaveBeenCalledWith(f.data);
  expect(f.props.close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("still available");
  await click(button("Restore"));
  expect(f.props.close).toHaveBeenCalledOnce();
});

it("names a selected version and flushes current changes before naming the current version", async () => {
  const f = fixture();
  const ui = await mount(h(SheetVersionHistory, f.props));
  await click(versionButton());
  await click(button("Name this version"));
  expect(button("Save name").disabled).toBe(true);
  await fillName("Budget milestone");
  f.history.list.mockResolvedValueOnce([{ ...f.version, name: "Budget milestone" }]);
  await submitName();
  expect(f.history.name).toHaveBeenCalledWith(f.version, "Budget milestone");
  expect(versionButton().textContent).toContain("Budget milestone");
  expect(f.props.prepare).not.toHaveBeenCalled();
  await click(button("Name current version"));
  await fillName("Current budget");
  await submitName();
  expect(f.props.prepare).toHaveBeenCalledOnce();
  expect(f.history.capture).toHaveBeenCalledWith("Current budget");
  expect(f.props.prepare.mock.invocationCallOrder[0]).toBeLessThan(
    f.history.capture.mock.invocationCallOrder[0] ?? 0,
  );
  await ui.unmount();
});

it("lets viewers browse and copy while blocking restore and naming, including revoked access", async () => {
  const f = fixture(true);
  const ui = await mount(h(SheetVersionHistory, f.props));
  expect(button("Name current version").disabled).toBe(true);
  await click(versionButton());
  expect(button("Restore this version").disabled).toBe(true);
  expect(button("Name this version").disabled).toBe(true);
  await click(button("Make a copy"));
  expect(f.props.copy).toHaveBeenCalledWith(f.data);
  expect(f.props.restore).not.toHaveBeenCalled();
  expect(f.history.name).not.toHaveBeenCalled();
  await ui.render(h(SheetVersionHistory, { ...f.props, readOnly: false }));
  await click(button("Restore this version"));
  await ui.render(h(SheetVersionHistory, f.props));
  expect(document.querySelector("fieldset")).toBeNull();
  await ui.render(h(SheetVersionHistory, { ...f.props, readOnly: false }));
  await click(button("Name this version"));
  await ui.render(h(SheetVersionHistory, f.props));
  expect(document.querySelector("form")).toBeNull();
});

it("discards stale preview responses and displays load, list and copy failures", async () => {
  const f = fixture();
  const waiting = deferred<Snapshot>();
  f.history.load.mockReturnValueOnce(waiting.promise);
  const ui = await mount(h(SheetVersionHistory, f.props));
  await click(versionButton());
  await click(button("Name current version"));
  await act(() => waiting.resolve(f.data));
  expect(document.querySelector('[aria-label="Version preview"]')).toBeNull();
  f.history.load.mockRejectedValueOnce(new Error("Missing"));
  await click(versionButton());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't load this version",
  );
  await click(versionButton());
  f.props.copy.mockRejectedValueOnce(new Error("No space"));
  await click(button("Make a copy"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("still available");
  await ui.unmount();
  f.history.list.mockRejectedValueOnce(new Error("Forbidden"));
  await mount(h(SheetVersionHistory, f.props));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't load version history",
  );
});

it("supports the menu's name-current entry and blocks after permission loss during flush", async () => {
  const f = fixture(false, true);
  const prepared = deferred<void>();
  f.props.prepare.mockReturnValueOnce(prepared.promise);
  const ui = await mount(h(SheetVersionHistory, f.props));
  await fillName("Pending name");
  await submitName();
  await ui.render(h(SheetVersionHistory, { ...f.props, readOnly: true }));
  await act(() => prepared.resolve());
  expect(f.history.capture).not.toHaveBeenCalled();
  expect(f.history.name).not.toHaveBeenCalled();
});

it("disposes a late preview mount and reports engine failure", async () => {
  const waiting = deferred<SheetEngine>();
  mocks.mount.mockReturnValueOnce(waiting.promise);
  const ui = await mount(h(VersionPreview, { snapshot: snapshot() }));
  await ui.unmount();
  const dispose = vi.fn();
  await act(() => waiting.resolve({ dispose } as unknown as SheetEngine));
  expect(dispose).toHaveBeenCalledOnce();
  mocks.mount.mockRejectedValueOnce(new Error("Unavailable"));
  await mount(h(VersionPreview, { snapshot: snapshot() }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't preview");
});
