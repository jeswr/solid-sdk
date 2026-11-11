// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { EditorMenubar } from "../src/apps/docs/components/editor-menubar";
import { FileMenu } from "../src/apps/docs/components/file-menu";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
const noop = () => {};
async function submenu(legacy = false) {
  const trigger = screen.getByRole(legacy ? "button" : "menuitem", {
    name: legacy ? "File menu" : "File",
  });
  await act(async () => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const sub = await screen.findByRole("menuitem", { name: "Version history" });
  await act(async () => sub.focus());
  fireEvent.keyDown(sub, { key: "ArrowRight" });
  return screen.findByRole("menuitem", { name: "Name current version…" });
}
it("offers accessible history and naming from the File submenu and preserves focus after selection", async () => {
  const showHistory = vi.fn(),
    nameVersion = vi.fn();
  render(
    <EditorMenubar
      editor={{} as Editor}
      actions={[]}
      mac={false}
      online
      readOnly={false}
      draft={false}
      outline={false}
      setOutline={noop}
      zoom={100}
      setZoom={noop}
      rename={noop}
      copy={noop}
      remove={noop}
      importFile={noop}
      print={noop}
      download={noop}
      help={noop}
      share={noop}
      shareDisabledReason={undefined}
      showHistory={showHistory}
      nameVersion={nameVersion}
      versionReason={undefined}
    />,
  );
  fireEvent.click(await submenu());
  await waitFor(() => expect(nameVersion).toHaveBeenCalledOnce());
  await submenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /See version history/ }));
  await waitFor(() => expect(showHistory).toHaveBeenCalledOnce());
});
it("keeps viewing available while explaining and blocking disabled naming in the compact menu", async () => {
  const showHistory = vi.fn(),
    nameVersion = vi.fn();
  render(
    <FileMenu
      copy={noop}
      rename={noop}
      remove={noop}
      shortcuts={noop}
      draft={false}
      readOnly
      download={noop}
      print={noop}
      importFile={noop}
      showHistory={showHistory}
      nameVersion={nameVersion}
      versionReason="Read-only documents cannot name or restore versions."
    />,
  );
  const item = await submenu(true);
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(item.getAttribute("aria-describedby") as string)?.textContent,
  ).toContain("Read-only");
  fireEvent.click(item);
  expect(nameVersion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: /See version history/ }));
  await waitFor(() => expect(showHistory).toHaveBeenCalledOnce());
});
