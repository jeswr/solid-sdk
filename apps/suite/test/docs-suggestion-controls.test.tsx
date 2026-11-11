// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Editor, EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { EditorMenubar, type EditorMenubarProps } from "../src/apps/docs/components/editor-menubar";
import {
  ResolveAllSuggestions,
  SuggestionModeSwitch,
  SuggestionPopover,
} from "../src/apps/docs/components/suggestion-controls";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { suggestionKey, suggestions } from "../src/apps/docs/lib/editor/suggestions";

let editor: Editor;
const author = "https://alice.example/#me";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
  HTMLElement.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  editor = new Editor({ extensions: baseExtensions(fetch), content: "<p>old</p>" });
});
afterEach(() => {
  cleanup();
  editor.destroy();
  vi.unstubAllGlobals();
});
function enable() {
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author }));
}
function insert() {
  enable();
  editor.commands.setTextSelection(4);
  editor.commands.insertContent("new");
}
const button = (name: string) => screen.getByRole("button", { name });

it("switches between Editing and Suggesting and reflects the current per-document mode", () => {
  const change = vi.fn();
  const view = render(<SuggestionModeSwitch suggesting={false} change={change} />);
  const select = screen.getByRole("combobox", { name: "Editing mode" }) as HTMLSelectElement;
  expect(select.value).toBe("editing");
  fireEvent.change(select, { target: { value: "suggesting" } });
  expect(change).toHaveBeenLastCalledWith(true);
  view.rerender(<SuggestionModeSwitch suggesting change={change} />);
  expect(select.value).toBe("suggesting");
  fireEvent.change(select, { target: { value: "editing" } });
  expect(change).toHaveBeenLastCalledWith(false);
});
it.each([
  true,
  false,
])("reviews an insertion with author/time, keeps the caret focus and resolves it (accept %s)", async (accept) => {
  insert();
  render(
    <>
      <EditorContent editor={editor} />
      <SuggestionPopover editor={editor} />
    </>,
  );
  const popup = await screen.findByRole("dialog", { name: "Review suggestion" });
  expect(popup.textContent).toContain(author);
  expect(popup.querySelector("time")?.dateTime).toBe(suggestions(editor.state.doc)[0]?.created);
  expect(popup.textContent).toContain("Suggested addition");
  fireEvent.click(button(accept ? "Accept" : "Reject"));
  expect(editor.state.doc.textContent).toBe(accept ? "oldnew" : "old");
  expect(suggestions(editor.state.doc)).toEqual([]);
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Review suggestion" })).toBeNull(),
  );
});
it("follows caret movement into a deletion, dismisses with Escape and reopens on revisiting", async () => {
  enable();
  editor.commands.setTextSelection({ from: 1, to: 4 });
  editor.commands.deleteSelection();
  editor.commands.setTextSelection(1);
  render(
    <>
      <EditorContent editor={editor} />
      <SuggestionPopover editor={editor} />
    </>,
  );
  let popup = await screen.findByRole("dialog", { name: "Review suggestion" });
  expect(popup.textContent).toContain("Suggested deletion");
  fireEvent.keyDown(popup, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Review suggestion" })).toBeNull(),
  );
  const marked = document.querySelector("del") as HTMLElement;
  fireEvent.click(marked);
  await screen.findByRole("dialog", { name: "Review suggestion" });
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Review suggestion" }), { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Review suggestion" })).toBeNull(),
  );
  fireEvent.click(editor.view.dom);
  // A different suggestion resets dismissal.
  await act(async () => {
    editor.commands.setTextSelection(4);
    editor.commands.insertContent("another");
  });
  popup = await screen.findByRole("dialog", { name: "Review suggestion" });
  expect(popup.textContent).toContain("Suggested addition");
  await act(async () => editor.commands.setTextSelection(2));
  expect((await screen.findByRole("dialog", { name: "Review suggestion" })).textContent).toContain(
    "Suggested deletion",
  );
  fireEvent.click(button("Reject"));
  expect(editor.state.doc.textContent).toBe("oldanother");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
});
it("hides reviewing for viewers and guards permission changes while a review is open", async () => {
  insert();
  const view = render(<SuggestionPopover editor={editor} />);
  await screen.findByRole("dialog", { name: "Review suggestion" });
  await act(async () => editor.setEditable(false));
  fireEvent.click(button("Accept"));
  expect(suggestions(editor.state.doc)).toHaveLength(1);
  view.rerender(<SuggestionPopover editor={editor} />);
  expect(screen.queryByRole("dialog", { name: "Review suggestion" })).toBeNull();
});
it.each([
  true,
  false,
])("confirms bulk resolution and resolves every suggestion in one transaction (accept %s)", async (accept) => {
  insert();
  editor.commands.setTextSelection({ from: 1, to: 4 });
  editor.commands.deleteSelection();
  const close = vi.fn();
  render(<ResolveAllSuggestions editor={editor} accept={accept} close={close} />);
  const action = accept ? "Accept" : "Reject";
  expect(await screen.findByRole("dialog")).toHaveProperty(
    "textContent",
    expect.stringContaining(`${action} all suggestions?`),
  );
  fireEvent.click(button(`${action} all`));
  expect(close).toHaveBeenCalledOnce();
  expect(editor.state.doc.textContent).toBe(accept ? "new" : "old");
  expect(suggestions(editor.state.doc)).toEqual([]);
});
it("cancels or dismisses bulk confirmation without applying changes and returns document focus", async () => {
  insert();
  const close = vi.fn();
  const view = render(<ResolveAllSuggestions editor={editor} accept close={close} />);
  fireEvent.click(button("Cancel"));
  expect(close).toHaveBeenCalledOnce();
  expect(suggestions(editor.state.doc)).toHaveLength(1);
  fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(2);
  view.unmount();
});
const noop = () => {};
function menuProps(): EditorMenubarProps {
  return {
    editor,
    actions: [],
    mac: false,
    online: true,
    readOnly: false,
    draft: false,
    outline: false,
    setOutline: noop,
    zoom: 100,
    setZoom: noop,
    rename: noop,
    copy: noop,
    remove: noop,
    importFile: noop,
    print: noop,
    download: noop,
    help: noop,
    share: noop,
    shareDisabledReason: undefined,
  };
}
async function openMenu(name: string) {
  const trigger = screen.getByRole("menuitem", { name });
  await act(async () => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}
it("offers Suggesting in View and bulk actions in Tools to editors", async () => {
  const setSuggesting = vi.fn(),
    resolve = vi.fn();
  const view = render(
    <EditorMenubar
      {...menuProps()}
      suggesting={false}
      setSuggesting={setSuggesting}
      resolveSuggestions={resolve}
    />,
  );
  await openMenu("View");
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Suggesting" }));
  expect(setSuggesting).toHaveBeenCalledWith(true);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await openMenu("Tools");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Accept all suggestions" }));
  await waitFor(() => expect(resolve).toHaveBeenLastCalledWith(true));
  await openMenu("Tools");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reject all suggestions" }));
  await waitFor(() => expect(resolve).toHaveBeenLastCalledWith(false));
  view.rerender(<EditorMenubar {...menuProps()} setSuggesting={setSuggesting} />);
  await openMenu("View");
  expect(
    (await screen.findByRole("menuitemcheckbox", { name: "Suggesting" })).getAttribute(
      "aria-checked",
    ),
  ).toBe("false");
});
it("does not offer suggesting or bulk resolution in read-only documents", async () => {
  render(
    <EditorMenubar
      {...menuProps()}
      readOnly
      suggesting
      setSuggesting={noop}
      resolveSuggestions={noop}
    />,
  );
  await openMenu("View");
  await screen.findByRole("menuitemcheckbox", { name: "Show outline" });
  expect(screen.queryByRole("menuitemcheckbox", { name: "Suggesting" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await openMenu("Tools");
  await screen.findByRole("menuitem", { name: /Word count/ });
  expect(screen.queryByRole("menuitem", { name: "Accept all suggestions" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Reject all suggestions" })).toBeNull();
});
