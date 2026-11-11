// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Editor, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON, yUndoPluginKey } from "@tiptap/y-tiptap";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement } from "yjs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { VersionAction, VersionHistory } from "../src/apps/docs/components/version-history";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { ResourceReadError } from "../src/apps/docs/lib/model/errors";
import { type DocumentVersion, DocumentVersionStore } from "../src/apps/docs/lib/model/versions";

const resource = "https://pod.example/docs/plan.ttl";
const webId = "https://pod.example/profile#me";
const version: DocumentVersion = {
  url: `${resource}/one.ttl`,
  snapshot: `${resource}/one.bin`,
  created: "2026-11-10T10:00:00Z",
  name: "First draft",
  kind: "named",
  creator: webId,
};
const json = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
let runtime: DocumentPersistence;
let editor: Editor;
let list: MockInstance<DocumentVersionStore["list"]>;
let load: MockInstance<DocumentVersionStore["load"]>;
let create: MockInstance<DocumentVersionStore["create"]>;
function snapshot(text = "Old content") {
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(fetch)), json(text));
  doc.getMap("document").set("instanceId", "plan");
  return doc;
}
function Harness({
  initiallyOpen = true,
  initiallyNaming = false,
}: {
  initiallyOpen?: boolean;
  initiallyNaming?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [naming, setNaming] = useState(initiallyNaming);
  const close = useCallback(() => setOpen(false), []);
  const closeNaming = useCallback(() => setNaming(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        History
      </button>
      <button type="button" onClick={() => setNaming(true)}>
        Name version
      </button>
      <VersionHistory
        runtime={runtime}
        editor={editor}
        title="Plan"
        zoom={100}
        open={open}
        close={close}
        naming={naming}
        closeNaming={closeNaming}
      />
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const doc = snapshot("Live content");
  editor = new Editor({ extensions: editorExtensions(doc, fetch) });
  runtime = {
    doc,
    stored: { url: resource, data: { instanceId: "plan" } },
    readOnly: false,
    online: true,
    session: { webId, storageUrl: "https://pod.example/", displayName: "Alice", fetch: vi.fn() },
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as DocumentPersistence;
  list = vi
    .spyOn(DocumentVersionStore.prototype, "list")
    .mockResolvedValue([
      version,
      { ...version, url: "two", name: undefined, creator: undefined },
      { ...version, url: "three", name: "Other author", creator: "https://bob.example/#me" },
    ]);
  load = vi
    .spyOn(DocumentVersionStore.prototype, "load")
    .mockImplementation(async () => snapshot());
  create = vi.spyOn(DocumentVersionStore.prototype, "create").mockResolvedValue(version);
});
afterEach(() => {
  cleanup();
  editor.destroy();
  runtime.doc.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string | RegExp) => screen.getByRole("button", { name });
async function select() {
  await waitFor(() => expect(button(/First draft/)).toBeTruthy());
  fireEvent.click(button(/First draft/));
  await screen.findByRole("textbox", { name: "Version preview" });
}

it("previews a separate read-only snapshot, restores in one collaborative edit and returns focus", async () => {
  const peer = new Doc();
  applyUpdate(peer, encodeStateAsUpdate(runtime.doc));
  const updates: Uint8Array[] = [];
  runtime.doc.on("update", (update: Uint8Array) => updates.push(update));
  render(<Harness initiallyOpen={false} />);
  button("History").focus();
  fireEvent.click(button("History"));
  expect(screen.getByRole("heading", { name: "Version history" })).toBe(document.activeElement);
  fireEvent.keyDown(window, { key: "x" });
  await screen.findByText("First draft");
  const beforePreview = Array.from(encodeStateAsUpdate(runtime.doc));
  const changed = vi.fn();
  editor.on("update", changed);
  await select();
  expect(Array.from(encodeStateAsUpdate(runtime.doc))).toEqual(beforePreview);
  expect(changed).not.toHaveBeenCalled();
  const preview = screen.getByRole("textbox", { name: "Version preview" });
  expect(preview.getAttribute("contenteditable")).toBe("false");
  expect(preview.getAttribute("aria-readonly")).toBe("true");
  expect(preview.textContent).toBe("Old content");
  expect(editor.getText()).toBe("Live content");
  expect(create).not.toHaveBeenCalled();
  expect(runtime.session.fetch).not.toHaveBeenCalled();
  fireEvent.click(button("Current version"));
  expect(editor.getText()).toBe("Live content");
  await select();
  await act(async () => button("Restore this version").focus());
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Cancel"));
  fireEvent.click(button("Restore this version"));
  updates.length = 0;
  fireEvent.click(button("Restore"));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Version history" })).toBeNull(),
  );
  expect(create).toHaveBeenCalledWith(runtime.doc, {
    kind: "automatic",
    name: "Before restore",
    creator: webId,
  });
  expect(runtime.flush).toHaveBeenCalledOnce();
  expect(editor.getText()).toBe("Old content");
  expect(editor.isEditable).toBe(true);
  expect(updates).toHaveLength(1);
  for (const update of updates) applyUpdate(peer, update);
  expect(editor.schema.nodeFromJSON(yDocToProsemirrorJSON(peer)).toJSON()).toEqual(
    editor.getJSON(),
  );
  expect(peer.getMap("document").get("instanceId")).toBe("plan");
  expect(document.activeElement).toBe(button("History"));
  peer.destroy();
});

it("names snapshots by Enter and button, rejects blank/duplicate submits and manages dialog focus", async () => {
  render(<Harness initiallyOpen={false} />);
  button("Name version").focus();
  fireEvent.click(button("Name version"));
  const input = screen.getByRole("textbox", { name: "Version name" });
  fireEvent.keyDown(input, { key: "a" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: " First draft " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(create).toHaveBeenCalledWith(runtime.doc, {
    kind: "named",
    name: "First draft",
    creator: webId,
  });
  expect(document.activeElement).toBe(button("Name version"));
  fireEvent.click(button("Name version"));
  fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Second" } });
  fireEvent.click(button("Save version"));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(button("Name version"));
  fireEvent.click(button("Cancel"));
  fireEvent.click(button("Name version"));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows name failures, blocks repeat Enter while in flight and permits retry", async () => {
  let fail!: (error: Error) => void;
  create.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(<Harness initiallyOpen={false} initiallyNaming />);
  const input = screen.getByLabelText("Version name");
  fireEvent.change(input, { target: { value: "Plan" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(create).toHaveBeenCalledOnce();
  await act(async () => fail(new Error("quota exceeded")));
  expect(screen.getByRole("alert").textContent).toBe("quota exceeded");
  fireEvent.click(button("Save version"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

// AUTHORED-BY Claude Opus 5.5
it("keeps a naming failure inside its dialog and clears it when the dialog closes", async () => {
  create.mockRejectedValue(new Error("quota exceeded"));
  render(<Harness initiallyNaming />);
  fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Plan" } });
  fireEvent.click(button("Save version"));
  await waitFor(() =>
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(
      "quota exceeded",
    ),
  );
  fireEvent.click(button("Cancel"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("quota exceeded")).toBeNull();
  fireEvent.click(button("Name version"));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Plan" } });
  fireEvent.click(button("Save version"));
  await within(screen.getByRole("dialog")).findByRole("alert");
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(button("Name version"));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
});

// AUTHORED-BY Claude Opus 5.5
it("records a restore as its own undo step, so undo returns the replaced content intact", async () => {
  render(<Harness />);
  await select();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() => expect(editor.getText()).toBe("Old content"));
  editor.commands.undo();
  expect(editor.getText()).toBe("Live content");
  editor.commands.redo();
  expect(editor.getText()).toBe("Old content");
});

// AUTHORED-BY Claude Opus 5.5
it("still restores when the editor has no collaborative undo state", async () => {
  editor.destroy();
  editor = new Editor({ extensions: baseExtensions(fetch), content: json("Live content") });
  expect(yUndoPluginKey.getState(editor.state)).toBeUndefined();
  render(<Harness />);
  await select();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() => expect(editor.getText()).toBe("Old content"));
});

it.each([
  "readOnly",
  "offline",
  "draft",
])("explains disabled naming/restoring for %s", async (state) => {
  if (state === "readOnly") runtime.readOnly = true;
  if (state === "offline") runtime.online = false;
  if (state === "draft") runtime.stored = undefined;
  render(<Harness initiallyNaming />);
  const input = screen.getByLabelText("Version name");
  fireEvent.change(input, { target: { value: "Plan" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const save = button("Save version");
  expect(save.getAttribute("aria-disabled")).toBe("true");
  expect(save.getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(save);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(button("Cancel"));
  if (state === "draft") {
    expect(screen.getByRole("alert").textContent).toContain("Save this document");
    return;
  }
  await select();
  const restore = button("Restore this version");
  expect(restore.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(restore);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("retains cached rows on offline failure, reports access errors and closes with Escape or Back", async () => {
  render(<Harness />);
  await screen.findByText("Unknown author");
  expect(screen.getByText("https://bob.example/#me")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  list.mockRejectedValueOnce(new ResourceReadError(resource, 403));
  fireEvent.click(button("History"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("permission"));
  expect(button(/First draft/)).toBeTruthy();
  fireEvent.click(button("Back to editing"));
  list.mockRejectedValueOnce(new TypeError("offline"));
  fireEvent.click(button("History"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("offline"));
});

it("shows identity and malformed snapshot failures without modifying live state", async () => {
  load.mockRejectedValueOnce(new Error("The update log belongs to a different document"));
  render(<Harness />);
  await screen.findByText("First draft");
  fireEvent.click(button(/First draft/));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("different document"),
  );
  expect(screen.getByText("This version couldn't be previewed.")).toBeTruthy();
  expect(editor.getText()).toBe("Live content");
  runtime.stored = { ...runtime.stored, data: {} } as DocumentPersistence["stored"];
  fireEvent.click(button(/First draft/));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("identity is unavailable"),
  );
});

it("aborts restore on safety snapshot failure or lost connectivity", async () => {
  render(<Harness />);
  await select();
  create.mockRejectedValueOnce(new Error("Safety snapshot failed"));
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Safety snapshot failed"));
  expect(editor.getText()).toBe("Live content");
  create.mockImplementationOnce(async () => {
    runtime.online = false;
    return version;
  });
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Reconnect with edit access"),
  );
  expect(editor.getText()).toBe("Live content");
});

it("ignores late previews and late list successes/failures after close", async () => {
  let finish!: (doc: Doc) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Harness />);
  await screen.findByText("First draft");
  fireEvent.click(button(/First draft/));
  expect(screen.getByText("Loading version…")).toBeTruthy();
  fireEvent.click(button("Current version"));
  const late = snapshot();
  const destroy = vi.spyOn(late, "destroy");
  await act(async () => finish(late));
  expect(screen.queryByRole("textbox", { name: "Version preview" })).toBeNull();
  expect(destroy).toHaveBeenCalledOnce();
  let reject!: (error: Error) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  fireEvent.click(button(/First draft/));
  fireEvent.click(button("Current version"));
  await act(async () => reject(new Error("late")));
  expect(screen.queryByRole("alert")).toBeNull();
  view.unmount();
  let resolveList!: (rows: DocumentVersion[]) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
  );
  const next = render(<Harness />);
  fireEvent.click(button("Back to editing"));
  await act(async () => resolveList([version]));
  next.unmount();
  list.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<Harness />);
  fireEvent.click(button("Back to editing"));
  await act(async () => reject(new Error("late")));
});

it("handles disappearing resource and teardown of an already destroyed editor", async () => {
  const props = {
    runtime,
    editor,
    title: "Plan",
    zoom: 100,
    open: true,
    close: vi.fn(),
    naming: false,
    closeNaming: vi.fn(),
  };
  const view = render(<VersionHistory {...props} />);
  await screen.findByText("First draft");
  runtime.stored = undefined;
  view.rerender(<VersionHistory {...props} />);
  fireEvent.click(button(/First draft/));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("identity is unavailable"),
  );
  editor.destroy();
  view.unmount();
});

it("supports focusable disabled actions and busy actions without invoking them", () => {
  const run = vi.fn();
  const view = render(
    <VersionAction reason="Reconnect" run={run}>
      Action
    </VersionAction>,
  );
  fireEvent.click(button("Action"));
  expect(
    document.getElementById(button("Action").getAttribute("aria-describedby") as string)
      ?.textContent,
  ).toBe("Reconnect");
  view.rerender(
    <VersionAction reason={undefined} busy run={run}>
      Action
    </VersionAction>,
  );
  fireEvent.click(button("Action"));
  expect(run).not.toHaveBeenCalled();
  view.rerender(
    <VersionAction reason={undefined} run={run}>
      Action
    </VersionAction>,
  );
  fireEvent.click(button("Action"));
  expect(run).toHaveBeenCalledOnce();
});

it("rejects unsupported snapshot nodes and destroys the temporary document", async () => {
  const malformed = new Doc();
  malformed.getXmlFragment("prosemirror").insert(0, [new XmlElement("unsupportedNode")]);
  const destroy = vi.spyOn(malformed, "destroy");
  load.mockResolvedValueOnce(malformed);
  render(<Harness />);
  await screen.findByText("First draft");
  fireEvent.click(button(/First draft/));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unsupportedNode"));
  expect(destroy).toHaveBeenCalledOnce();
  expect(editor.getText()).toBe("Live content");
  expect(create).not.toHaveBeenCalled();
});
