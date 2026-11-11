// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Editor, EditorContent, getSchema } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import {
  type CommentActions,
  CommentComposer,
  CommentsSidebar,
} from "../src/apps/docs/components/comments-sidebar";
import { EditorMenubar } from "../src/apps/docs/components/editor-menubar";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { useDocumentComments } from "../src/apps/docs/hooks/use-document-comments";
import { captureCommentAnchor } from "../src/apps/docs/lib/editor/comment-anchors";
import { commentKey } from "../src/apps/docs/lib/editor/comment-decorations";
import {
  type CommentAnchor,
  type CommentThread,
  DocumentCommentStore,
} from "../src/apps/docs/lib/model/comments";
import { ResourceWriteError } from "../src/apps/docs/lib/model/errors";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const resource = "https://pod.example/docs/plan.ttl";
const webId = "https://pod.example/profile#me";
let runtime: DocumentPersistence;
let editor: Editor;
let anchor: CommentAnchor;
let root: CommentThread["root"];
let thread: CommentThread;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
function Harness({ target = editor }: { target?: Editor | null }) {
  const comments = useDocumentComments(runtime, target);
  return (
    <>
      <EditorContent editor={target} />
      {comments.controls}
      {comments.sidebar}
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(fetch)), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Before word after" }] }],
  });
  editor = new Editor({ extensions: editorExtensions(doc, fetch) });
  editor.commands.setTextSelection({ from: 8, to: 12 });
  anchor = captureCommentAnchor(editor.state);
  const pod = createDemoPod({ root: "https://pod.example/", seed: [] });
  runtime = {
    doc,
    stored: { url: resource },
    online: true,
    readOnly: true,
    session: { webId, storageUrl: "https://pod.example/", displayName: "Alice", fetch: pod.fetch },
  } as unknown as DocumentPersistence;
  root = {
    url: "https://pod.example/docs/plan/comments/one.ttl",
    etag: '"one"',
    text: "Discuss",
    creator: webId,
    created: "2026-11-10T10:00:00Z",
    kind: "root",
    target: resource,
    anchor,
    resolved: false,
  };
  thread = {
    root,
    replies: [
      {
        ...root,
        url: "reply",
        kind: "reply",
        text: "Another opinion",
        creator: "https://bob.example/#me",
        anchor: undefined,
        target: root.url,
      },
    ],
  };
});
afterEach(() => {
  cleanup();
  editor.destroy();
  runtime.doc.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("creates, highlights and persists a comment on a read-only document; replies, edits, resolves and reopens", async () => {
  const view = render(<Harness />);
  const before = runtime.doc.store.clients.size;
  fireEvent.click(button("Add comment"));
  expect(screen.getByRole("complementary", { name: "Comments" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Add comment"));
  fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "Discuss" } });
  fireEvent.click(button("Comment"));
  await screen.findByText("Discuss");
  expect(screen.queryByLabelText("Add comment")).toBeNull();
  expect(editor.view.dom.querySelector(".docs-comment-anchor")?.textContent).toBe("word");
  expect(runtime.doc.store.clients.size).toBe(before);
  expect(button("Comments (1 open)")).toBeTruthy();
  fireEvent.click(button("Reply to thread"));
  fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "Agreed" } });
  fireEvent.click(button("Reply"));
  await screen.findByText("Agreed");
  fireEvent.click(screen.getAllByRole("button", { name: "Comment options" })[1] as HTMLElement);
  fireEvent.click(button("Edit"));
  fireEvent.change(screen.getByLabelText("Edit comment"), { target: { value: "Updated reply" } });
  fireEvent.click(button("Save"));
  await screen.findByText("Updated reply");
  fireEvent.click(button("Resolve"));
  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(button("Comments (0 open)")).toBeTruthy();
  expect(editor.view.dom.querySelector(".docs-comment-anchor")).toBeNull();
  fireEvent.click(screen.getByLabelText("Show resolved"));
  await screen.findByText("Resolved");
  fireEvent.click(screen.getAllByRole("button", { name: "Comment options" })[0] as HTMLElement);
  fireEvent.click(button("Reopen"));
  await waitFor(() => expect(screen.queryByText("Resolved")).toBeNull());
  fireEvent.click(button("Close comments"));
  fireEvent.click(button("Comments (1 open)"));
  await screen.findByText("Discuss");
  fireEvent.click(button("word"));
  expect(editor.state.selection.from).toBe(8);
  fireEvent.click(screen.getAllByRole("button", { name: "Comment options" })[1] as HTMLElement);
  fireEvent.click(button("Delete"));
  await waitFor(() => expect(screen.queryByText("Updated reply")).toBeNull());
  fireEvent.click(button("Comment options"));
  fireEvent.click(button("Delete"));
  await screen.findByText("No comments yet");
  view.unmount();
  render(<Harness />);
  fireEvent.click(button("Comments (0 open)"));
  await screen.findByText("No comments yet");
});
it("activates from highlights, follows edits, labels orphan threads, and supports Escape and focus restoration", async () => {
  vi.spyOn(DocumentCommentStore.prototype, "list").mockResolvedValue([thread]);
  render(<Harness />);
  await waitFor(() => expect(button("Comments (1 open)")).toBeTruthy());
  await act(async () => commentKey.getState(editor.state)?.activate?.(root.url));
  const article = await screen.findByRole("article", { name: `${webId}: word` });
  expect(article).toBe(document.activeElement);
  fireEvent.keyDown(article, { key: "a" });
  fireEvent.keyDown(article, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  button("Comments (1 open)").focus();
  fireEvent.click(button("Comments (1 open)"));
  fireEvent.click(button("Comments (1 open)"));
  expect(document.activeElement).toBe(button("Comments (1 open)"));
  fireEvent.click(button("Add comment"));
  fireEvent.keyDown(screen.getByLabelText("Add comment"), { key: "Escape" });
  expect(screen.queryByLabelText("Add comment")).toBeNull();
  fireEvent.click(button("Add comment"));
  fireEvent.keyDown(screen.getByRole("heading", { name: "Comments" }), { key: "Escape" });
  expect(screen.queryByLabelText("Add comment")).toBeNull();
  await act(async () => editor.commands.deleteRange({ from: 8, to: 12 }));
  expect(screen.getByText("Original text was deleted")).toBeTruthy();
  fireEvent.click(button("word"));
  fireEvent.click(button("Comment options"));
  fireEvent.keyDown(button("Edit"), { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(document.activeElement).toBe(button("Comment options"));
  fireEvent.click(button("Comment options"));
  fireEvent.click(button("Edit"));
  fireEvent.click(button("Cancel"));
  expect(document.activeElement).toBe(button("Comment options"));
});
it("explains unsaved, offline and empty selection actions; reports permission and anchor failures", async () => {
  runtime.stored = undefined;
  const view = render(<Harness />);
  expect(button("Add comment").getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(button("Add comment").getAttribute("aria-describedby") as string)
      ?.textContent,
  ).toContain("Save this document");
  fireEvent.click(button("Add comment"));
  expect(screen.queryByRole("complementary")).toBeNull();
  runtime.stored = { url: resource } as DocumentPersistence["stored"];
  runtime.online = false;
  view.rerender(<Harness />);
  expect(
    document.getElementById(button("Add comment").getAttribute("aria-describedby") as string)
      ?.textContent,
  ).toContain("Reconnect");
  runtime.online = true;
  view.rerender(<Harness />);
  await act(async () => editor.commands.setTextSelection(1));
  expect(button("Add comment").getAttribute("aria-disabled")).toBe("true");
  await act(async () => editor.commands.setTextSelection({ from: 8, to: 12 }));
  const create = vi
    .spyOn(DocumentCommentStore.prototype, "create")
    .mockRejectedValue(new ResourceWriteError(resource, 403));
  fireEvent.click(button("Add comment"));
  fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "Discuss" } });
  fireEvent.click(button("Comment"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You don't have permission to comment on this document.",
  );
  expect(screen.getByLabelText("Add comment")).toBeTruthy();
  create.mockRestore();
  fireEvent.click(button("Comment"));
  await screen.findByText("Discuss");
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(button("Add comment"));
  fireEvent.click(button("Cancel"));
  const binding = vi.spyOn(editor.state.doc, "textBetween").mockImplementationOnce(() => {
    throw new Error("anchor failed");
  });
  // The action checks the saved selection first; changing the capture after render exercises its failure boundary.
  fireEvent.click(button("Add comment"));
  binding.mockRestore();
  expect(screen.getByRole("alert").textContent).toBe("anchor failed");
});
it("refreshes on open, focus and visible polling, retains rows on failures, and ignores late results", async () => {
  const list = vi.spyOn(DocumentCommentStore.prototype, "list").mockResolvedValue([thread]);
  const interval = vi.spyOn(window, "setInterval");
  const view = render(<Harness />);
  await waitFor(() => expect(button("Comments (1 open)")).toBeTruthy());
  fireEvent.click(button("Comments (1 open)"));
  await screen.findByText("Discuss");
  const tick = interval.mock.calls.findLast(([, time]) => time === 30_000)?.[0] as () => void;
  const before = list.mock.calls.length;
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    tick();
  });
  expect(list).toHaveBeenCalledTimes(before);
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    tick();
  });
  expect(list).toHaveBeenCalledTimes(before + 1);
  list.mockRejectedValueOnce(new Error("network"));
  fireEvent.focus(window);
  await screen.findByRole("alert");
  expect(screen.getByText("Discuss")).toBeTruthy();
  let finish!: (rows: CommentThread[]) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.focus(window);
  view.unmount();
  await act(async () => finish([]));
  let fail!: (error: Error) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const late = render(<Harness />);
  late.unmount();
  await act(async () => fail(new Error("late")));
});
it("renders without an editor and handles roots without anchors", async () => {
  const list = vi
    .spyOn(DocumentCommentStore.prototype, "list")
    .mockResolvedValue([{ root: { ...root, anchor: undefined }, replies: [] }, thread]);
  const view = render(<Harness target={null} />);
  fireEvent.click(button("Comments (0 open)"));
  expect(list).not.toHaveBeenCalled();
  view.rerender(<Harness />);
  await screen.findByText("Original text was deleted");
  expect(screen.getAllByRole("article")).toHaveLength(2);
});
it("manages composer failure, submit, empty text, cancel and duplicate submissions", async () => {
  const cancel = vi.fn();
  const submit = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(false);
  const view = render(
    <CommentComposer
      label="Add comment"
      reason={undefined}
      quote="word"
      submit={submit}
      cancel={cancel}
    />,
  );
  fireEvent.submit(screen.getByLabelText("Add comment").closest("form") as HTMLElement);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: " Text " } });
  fireEvent.keyDown(screen.getByLabelText("Add comment"), { key: "a" });
  fireEvent.click(button("Comment"));
  await waitFor(() => expect(submit).toHaveBeenCalledWith("Text"));
  expect(cancel).not.toHaveBeenCalled();
  view.rerender(
    <CommentComposer label="Add comment" reason="Reconnect" submit={submit} cancel={cancel} />,
  );
  fireEvent.submit(screen.getByLabelText("Add comment").closest("form") as HTMLElement);
  expect(submit).toHaveBeenCalledTimes(1);
  let finish!: (result: boolean) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  view.rerender(
    <CommentComposer label="Add comment" reason={undefined} submit={submit} cancel={cancel} />,
  );
  fireEvent.click(button("Comment"));
  fireEvent.submit(screen.getByLabelText("Add comment").closest("form") as HTMLElement);
  fireEvent.keyDown(screen.getByLabelText("Add comment"), { key: "Escape" });
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => finish(true));
  expect(cancel).toHaveBeenCalledOnce();
  fireEvent.click(button("Cancel"));
  expect(cancel).toHaveBeenCalledTimes(2);
});
it("supports pure sidebar replies, resolved threads by another author and menu Escape", async () => {
  const actions: CommentActions = {
    reply: vi.fn().mockResolvedValue(true),
    edit: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue(true),
  };
  const props = {
    threads: [{ root: { ...root, resolved: true, creator: "Bob" }, replies: [] }],
    active: undefined,
    composer: undefined,
    reason: undefined,
    error: undefined,
    webId,
    showResolved: true,
    setShowResolved: vi.fn(),
    select: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    create: vi.fn(),
    actions,
    orphan: () => false,
  };
  render(<CommentsSidebar {...props} />);
  fireEvent.click(screen.getByText("Discuss"));
  expect(props.select).toHaveBeenCalledWith(props.threads[0]?.root);
  fireEvent.click(button("Comment options"));
  fireEvent.keyDown(button("Reopen"), { key: "a" });
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  fireEvent.click(button("Reopen"));
  expect(actions.resolve).toHaveBeenCalledWith(props.threads[0]?.root, false);
});
it("offers Insert Comment independently of edit access and describes unavailable selections", async () => {
  const addComment = vi.fn();
  const noop = () => {};
  const props = {
    editor,
    actions: [],
    mac: false,
    online: true,
    readOnly: true,
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
    addComment,
  };
  const view = render(<EditorMenubar {...props} />);
  async function openInsert() {
    const insert = screen.getByRole("menuitem", { name: "Insert" });
    await act(async () => insert.focus());
    fireEvent.keyDown(insert, { key: "ArrowDown" });
    return screen.findByRole("menuitem", { name: /^Comment/ });
  }
  fireEvent.click(await openInsert());
  await waitFor(() => expect(addComment).toHaveBeenCalledOnce());
  view.rerender(<EditorMenubar {...props} commentReason="Select text" />);
  const item = await openInsert();
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(item.getAttribute("aria-describedby") as string)?.textContent,
  ).toBe("Select text");
});

it("guards stale controller callbacks, overlapping actions and teardown, and orders orphan anchors last", async () => {
  const list = vi
    .spyOn(DocumentCommentStore.prototype, "list")
    .mockImplementation(async (position) => {
      position?.(root);
      position?.({ ...root, anchor: undefined });
      return [
        thread,
        {
          root: {
            ...root,
            url: "lost",
            anchor: { ...anchor, start: "!", end: "!", exact: "lost" },
          },
          replies: [],
        },
      ];
    });
  const hook = renderHook(({ target }) => useDocumentComments(runtime, target), {
    initialProps: { target: editor as Editor | null },
  });
  await waitFor(() => expect(hook.result.current.controls.props.count).toBe(2));
  await act(async () => hook.result.current.controls.props.toggle());
  await act(async () => {
    expect(await hook.result.current.sidebar?.props.create("No composer")).toBe(true);
  });
  // The mounted composer may have captured callbacks just before connectivity or selection changes.
  const initial = hook.result.current;
  runtime.online = false;
  hook.rerender({ target: editor });
  await act(async () => hook.result.current.add());
  await act(async () =>
    expect(await hook.result.current.sidebar?.props.actions.reply(root, "offline")).toBe(false),
  );
  runtime.online = true;
  hook.rerender({ target: editor });
  let finish!: () => void;
  const reply = vi.spyOn(DocumentCommentStore.prototype, "reply").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(root);
      }),
  );
  let first!: Promise<boolean>;
  await act(async () => {
    first = hook.result.current.sidebar?.props.actions.reply(root, "one");
  });
  await act(async () =>
    expect(await hook.result.current.sidebar?.props.actions.reply(root, "two")).toBe(false),
  );
  await act(async () => {
    finish();
    await first;
  });
  expect(reply).toHaveBeenCalledOnce();
  await act(async () => editor.commands.setTextSelection(1));
  await act(async () => hook.result.current.add());
  hook.rerender({ target: null });
  await act(async () => initial.sidebar?.props.select({ ...root, anchor: undefined }));
  editor.destroy();
  hook.rerender({ target: editor });
  hook.unmount();
  expect(list).toHaveBeenCalled();
});
