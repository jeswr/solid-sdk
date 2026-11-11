// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { CellComments, WorkbookComments } from "../src/apps/sheets/components/cell-comments";
import { WorkbookCommentAnchors } from "../src/apps/sheets/lib/comments/anchors";
import type { CellAnchor } from "../src/apps/sheets/lib/comments/selector";
import { type CellComment, CellCommentStore } from "../src/apps/sheets/lib/comments/store";
import type { SheetEngine } from "../src/apps/sheets/lib/contract";
import type { StructuralEdit } from "../src/apps/sheets/lib/refs/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const sessionState = vi.hoisted(() => ({
  current: { status: "loading" } as Record<string, unknown>,
}));
vi.mock("@/lib/session/pod-session", () => ({ usePodSessionState: () => sessionState.current }));
const container = "https://pod.example/sheets/book/";
const webId = "https://pod.example/profile#me";
const anchor = { sheetId: "stable", cell: "B3", deleted: false };
const button = (name: string | RegExp) => screen.getByRole("button", { name });
let store: CellCommentStore;
let engine: SheetEngine;
let select: (anchor: CellAnchor | undefined) => void;
let structure: (edit: StructuralEdit) => void;
let unselect: ReturnType<typeof vi.fn>;
let unstructure: ReturnType<typeof vi.fn>;
let pod: ReturnType<typeof createDemoPod>;
let root: CellComment;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  pod = createDemoPod({ root: "https://pod.example/", seed: [] });
  await writeRdf(container, new Store(), { fetchImpl: pod.fetch, createOnly: true });
  store = new CellCommentStore(container, pod.fetch);
  unselect = vi.fn();
  unstructure = vi.fn();
  const anchors = new WorkbookCommentAnchors({});
  let commentsLoading = false;
  let changed: () => void = () => {};
  structure = (edit) => {
    if (commentsLoading) return;
    anchors.shift(edit);
    changed();
  };
  engine = {
    setCommentsLoading: vi.fn((value: boolean) => {
      commentsLoading = value;
    }),
    registerCommentAnchors: (values: Record<string, CellAnchor>) => anchors.register(values),
    trackCommentDraft: (anchor: CellAnchor) => anchors.track(anchor),
    onChange: (listener: () => void) => {
      changed = listener;
      return unstructure;
    },
    selectedCell: () => anchor,
    selectCell: vi.fn(),
    onSelection: (listener: (anchor: CellAnchor | undefined) => void) => {
      select = listener;
      return unselect;
    },
    snapshot: () => ({ sheets: { stable: { name: "Renamed sheet" } }, ...anchors.snapshot() }),
  } as unknown as SheetEngine;
  sessionState.current = {
    status: "ready",
    session: { storageUrl: "https://pod.example/", webId, fetch: pod.fetch },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(local = true) {
  const view = render(<CellComments store={store} engine={engine} webId={webId} local={local} />);
  if (local)
    await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
  return view;
}
async function add(text = "Discuss") {
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByLabelText("Comment on B3"), { target: { value: text } });
  fireEvent.click(button("Send"));
  await screen.findByText(text);
}
async function seed() {
  root = await store.create("Root", webId, anchor);
}
it("adds, replies, edits, resolves, reopens and deletes own comments through real RDF storage", async () => {
  const view = await mount();
  await add('<script>alert("x")</script>');
  expect(document.querySelector(".sht-comments script")).toBeNull();
  expect(screen.getByRole("region", { name: "Comments" })).toBeTruthy();
  expect(screen.getByRole("list", { name: "Comment threads" }).children).toHaveLength(1);
  expect(button("Comments (1 on this sheet)")).toBeTruthy();
  expect(
    screen.getByText('<script>alert("x")</script>').closest("li")?.getAttribute("aria-current"),
  ).toBe("location");
  fireEvent.click(button("Renamed sheet!B3"));
  expect(engine.selectCell).toHaveBeenCalledWith(anchor);
  fireEvent.click(button("Reply"));
  expect(document.activeElement).toBe(screen.getByLabelText("Reply text"));
  fireEvent.change(screen.getByLabelText("Reply text"), { target: { value: "Agreed" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Agreed");
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1] as HTMLElement);
  fireEvent.change(screen.getByLabelText("Edit comment"), { target: { value: "Updated reply" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Updated reply");
  fireEvent.click(button("Resolve"));
  await screen.findByText("Resolved");
  fireEvent.click(button("Reopen"));
  await waitFor(() => expect(screen.queryByText("Resolved")).toBeNull());
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement);
  await waitFor(() => expect(screen.queryByText("Updated reply")).toBeNull());
  fireEvent.click(button("Delete"));
  await screen.findByText("No comments yet");
  fireEvent.click(button("Close comments"));
  expect(document.activeElement).toBe(button("Comments (0 on this sheet)"));
  view.unmount();
  expect(unselect).toHaveBeenCalledOnce();
  expect(unstructure).toHaveBeenCalledOnce();
});
it("captures selected cell when composing, supports keyboard shortcut and highlights cell selections", async () => {
  await seed();
  await mount();
  fireEvent.keyDown(window, { key: "x" });
  fireEvent.keyDown(window, { key: "M", ctrlKey: true, altKey: true });
  expect(screen.getByLabelText("Comment on B3")).toBe(document.activeElement);
  await act(async () => select({ ...anchor, cell: "C4" }));
  fireEvent.change(screen.getByLabelText("Comment on B3"), { target: { value: "Captured cell" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Captured cell");
  expect((await store.list()).every(({ root: r }) => r.anchor?.cell === "B3")).toBe(true);
  expect(screen.getByText("Root").closest("li")?.getAttribute("aria-current")).toBeNull();
  await act(async () => select(anchor));
  expect(screen.getByText("Root").closest("li")?.getAttribute("aria-current")).toBe("location");
  fireEvent.click(button("Comment"));
  fireEvent.click(button("Cancel"));
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(button("Comments (2 on this sheet)"));
  expect(screen.queryByRole("region")).toBeNull();
});
it("shifts through row and column mutations, retains deleted cells and counts by stable sheet ID", async () => {
  await seed();
  await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 2, count: 2 }),
  );
  await screen.findByRole("button", { name: "Renamed sheet!B5" });
  await act(async () =>
    structure({ sheet: "stable", axis: "column", kind: "delete", index: 2, count: 1 }),
  );
  await screen.findByText("Cell deleted");
  expect((button("Renamed sheet!B3") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => select({ ...anchor, sheetId: "other" }));
  expect(button("Comments (0 on this sheet)")).toBeTruthy();
});

it.each([
  "mount",
  "refresh",
])("holds structural edits until a delayed %s registers a collaborator's missing anchor", async (when) => {
  const setCommentsLoading = engine.setCommentsLoading;
  if (when === "refresh") await mount();
  root = await store.create("Collaborator comment", "https://collaborator.example/#me", anchor);
  const list = store.list.bind(store);
  let finish: () => Promise<void> = async () => {};
  vi.spyOn(store, "list").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = async () => resolve(await list());
      }),
  );
  if (when === "mount") render(<CellComments store={store} engine={engine} webId={webId} local />);
  else fireEvent.focus(window);
  expect(setCommentsLoading).toHaveBeenLastCalledWith(true);
  expect(engine.snapshot().commentAnchors).toBeUndefined();
  const insert = { sheet: "stable", axis: "row", kind: "insert", index: 2, count: 1 } as const;
  await act(async () => structure(insert));
  await act(async () => finish());
  await waitFor(() => expect(setCommentsLoading).toHaveBeenLastCalledWith(false));
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { [root.url]: { sheetId: "stable", cell: "B3" } },
  });
  fireEvent.click(button("Comments (1 on this sheet)"));
  expect(button("Renamed sheet!B3")).toBeTruthy();
  await act(async () => structure(insert));
  expect(button("Renamed sheet!B4")).toBeTruthy();
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { [root.url]: { sheetId: "stable", cell: "B4" } },
  });
  expect((await store.list())[0]?.root.anchor).toEqual(anchor);
});
it("allows append-only comments on view-only grids while disabling changes to existing comments", async () => {
  await seed();
  store = new CellCommentStore(container, async (url, init) => {
    const response = await pod.fetch(url, init);
    response.headers.set("wac-allow", 'user="read append"');
    return response;
  });
  await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(button("Resolve").title).toContain("Write access");
  await add("Append allowed");
  fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0] as HTMLElement);
  fireEvent.change(screen.getByLabelText("Reply text"), { target: { value: "Append reply" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Append reply");
});
it("keeps comments readable without Append, with foreign authors and deleted sheets", async () => {
  await seed();
  await store.reply(root, "Other reply", "https://bob.example/#me");
  vi.spyOn(store, "permissions").mockResolvedValue({ append: false, write: false });
  engine.snapshot = () => ({ sheets: {} });
  await mount(false);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Other reply");
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect((button("Comment") as HTMLButtonElement).disabled).toBe(true);
  expect(button("Comment").parentElement?.title).toContain("Append access");
  expect(button("Reply").title).toContain("Append access");
  fireEvent.keyDown(window, { key: "m", ctrlKey: true, altKey: true });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Cell deleted")).toBeTruthy();
});
it("requires a selected cell and explains offline controls", async () => {
  const view = render(<CellComments store={store} engine={null} webId={webId} local />);
  await waitFor(() => expect(button("Comment").parentElement?.title).toBe("Select a cell first."));
  fireEvent.keyDown(window, { key: "m", ctrlKey: true, altKey: true });
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(<CellComments store={store} engine={engine} webId={webId} local />);
  await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  view.rerender(<CellComments store={store} engine={engine} webId={webId} local />);
  expect(button("Comment").parentElement?.title).toBe("Reconnect to comment.");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
it("retains drafts after failures, rejects empty/double submissions and refreshes on focus", async () => {
  await mount();
  const create = vi.spyOn(store, "create").mockRejectedValueOnce(new Error("Permission changed"));
  fireEvent.click(button("Comment"));
  const input = screen.getByRole("textbox");
  const form = input.closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Draft" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Permission changed");
  expect((input as HTMLTextAreaElement).value).toBe("Draft");
  create.mockRejectedValueOnce("offline");
  fireEvent.click(button("Send"));
  await screen.findByText("Couldn't save this comment.");
  let finish: (value: CellComment) => void = () => {};
  create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(button("Send"));
  fireEvent.submit(form);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
  await act(async () => {
    await seed();
    finish(root);
  });
  await screen.findByText("Root");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  const list = vi.spyOn(store, "list");
  fireEvent.focus(window);
  await waitFor(() => expect(list).toHaveBeenCalled());
  fireEvent.click(button("Refresh comments"));
  await waitFor(() =>
    expect((button("Refresh comments") as HTMLButtonElement).disabled).toBe(false),
  );
});
it.each([
  new Error("Can't load"),
  "offline",
])("releases editing after a load failure (%s) and permits retrying", async (cause) => {
  const list = vi.spyOn(store, "list").mockRejectedValueOnce(cause);
  const onLoadingChange = vi.fn();
  const view = render(
    <CellComments
      store={store}
      engine={engine}
      webId={webId}
      local
      onLoadingChange={onLoadingChange}
    />,
  );
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText(cause instanceof Error ? cause.message : "Couldn't load comments.");
  expect(engine.setCommentsLoading).toHaveBeenLastCalledWith(false);
  expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  expect((button("Comment") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: "m", ctrlKey: true, altKey: true });
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(button("Retry"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(engine.setCommentsLoading).toHaveBeenLastCalledWith(false);
  expect((button("Comment") as HTMLButtonElement).disabled).toBe(false);
  let finish: (rows: []) => void = () => {};
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.focus(window);
  view.unmount();
  await act(async () => finish([]));
  list.mockRejectedValueOnce(new Error("Late"));
  const late = render(<CellComments store={store} engine={engine} webId={webId} local />);
  late.unmount();
  await act(async () => {});
});

it.each([
  "list",
  "permissions",
] as const)("disables comment actions after rejected %s refreshes while registered anchors keep following edits", async (method) => {
  await seed();
  await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  fireEvent.click(button("Edit"));
  fireEvent.change(screen.getByLabelText("Edit comment"), { target: { value: "Draft edit" } });
  const edit = vi.spyOn(store, "edit");
  vi.spyOn(store, method).mockRejectedValueOnce(new Error("Comments unavailable"));
  fireEvent.focus(window);
  await screen.findByText("Comments unavailable");
  expect(engine.setCommentsLoading).toHaveBeenLastCalledWith(false);
  for (const name of ["Comment", "Reply", "Edit", "Delete", "Resolve", "Send"])
    expect((button(name) as HTMLButtonElement).disabled, name).toBe(true);
  fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);
  expect(edit).not.toHaveBeenCalled();
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  expect(button("Renamed sheet!B4")).toBeTruthy();
  fireEvent.click(button("Retry"));
  await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(button("Renamed sheet!B4")).toBeTruthy();
  for (const name of ["Comment", "Reply", "Edit", "Delete", "Resolve", "Send"])
    expect((button(name) as HTMLButtonElement).disabled, name).toBe(false);
});
it("renders session-bound comments and uses the anonymous read transport for public views", async () => {
  sessionState.current = { status: "loading" };
  const view = render(<WorkbookComments container={container} engine={engine} />);
  expect(screen.queryByRole("toolbar")).toBeNull();
  sessionState.current = {
    status: "ready",
    session: { storageUrl: "https://pod.example/", webId, fetch: pod.fetch },
  };
  view.rerender(<WorkbookComments container={container} engine={engine} />);
  await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
  view.unmount();
  await seed();
  const publicFetch = vi.fn(pod.fetch);
  sessionState.current = {
    status: "ready",
    session: { storageUrl: "https://pod.example/other/", webId, fetch: vi.fn(), publicFetch },
  };
  render(<WorkbookComments container={container} engine={engine} />);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Root");
  expect((button("Comment") as HTMLButtonElement).disabled).toBe(true);
  expect(publicFetch.mock.calls.every(([, init]) => init?.credentials === "omit")).toBe(true);
});

it("can reply with no grid selection, including rapid duplicate refreshes", async () => {
  await seed();
  await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  await act(async () => select(undefined));
  fireEvent.click(button("Reply"));
  fireEvent.change(screen.getByLabelText("Reply text"), {
    target: { value: "No selection needed" },
  });
  fireEvent.click(button("Send"));
  await screen.findByText("No selection needed");
  await waitFor(() =>
    expect((button("Refresh comments") as HTMLButtonElement).disabled).toBe(false),
  );
  let finish: (rows: []) => void = () => {};
  const list = vi.spyOn(store, "list").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = button("Refresh comments");
  act(() => {
    refresh.click();
    refresh.click();
  });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await act(async () => finish([]));
});

it("isolates late successful and failed writes across store/account changes and does no post-unmount refresh", async () => {
  await seed();
  for (const fail of [false, true]) {
    const previous = store;
    const list = vi.spyOn(previous, "list");
    const view = await mount();
    let finish: () => void = () => {};
    vi.spyOn(previous, "create").mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => (fail ? reject(new Error("Old account write")) : resolve(root));
        }),
    );
    fireEvent.click(button("Comment"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old draft" } });
    fireEvent.click(button("Send"));
    const next = new CellCommentStore(container, pod.fetch);
    view.rerender(
      <CellComments store={next} engine={engine} webId="https://next.example/#me" local />,
    );
    await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button("Comment"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New draft" } });
    list.mockClear();
    const register = vi.spyOn(engine, "registerCommentAnchors").mockClear();
    await act(async () => finish());
    expect(list).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("New draft");
    expect(screen.queryByText("Comment sent.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((button("Send") as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
    store = next;
  }
  const list = vi.spyOn(store, "list");
  const view = await mount();
  let finish: () => void = () => {};
  vi.spyOn(store, "create").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(root);
      }),
  );
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Pending" } });
  fireEvent.click(button("Send"));
  view.unmount();
  list.mockClear();
  await act(async () => finish());
  expect(list).not.toHaveBeenCalled();
});

it("isolates late loads and errors across WebID changes even when the store is reused", async () => {
  await seed();
  let finish: (rows: Awaited<ReturnType<CellCommentStore["list"]>>) => void = () => {};
  const list = vi.spyOn(store, "list").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<CellComments store={store} engine={engine} webId={webId} local />);
  list.mockResolvedValueOnce([]);
  view.rerender(
    <CellComments store={store} engine={engine} webId="https://next.example/#me" local />,
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  fireEvent.click(button("Comments (0 on this sheet)"));
  await act(async () => finish([{ root, replies: [] }]));
  expect(screen.queryByText("Root")).toBeNull();
  expect(button("Comments (0 on this sheet)")).toBeTruthy();
  let reject: (error: Error) => void = () => {};
  list.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  fireEvent.focus(window);
  list.mockResolvedValueOnce([]);
  view.rerender(
    <CellComments store={store} engine={engine} webId="https://third.example/#me" local />,
  );
  await act(async () => reject(new Error("Old account load")));
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([
  "resolve",
  "reject",
] as const)("keeps editing locked when a superseded list settles (%s) before the current list", async (outcome) => {
  await seed();
  const list = vi.spyOn(store, "list");
  let first: () => void = () => {};
  let second: () => void = () => {};
  list.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        first = () =>
          outcome === "resolve"
            ? resolve([{ root, replies: [] }])
            : reject(new Error("Superseded load"));
      }),
  );
  render(<CellComments store={store} engine={engine} webId={webId} local />);
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        second = () => resolve([{ root, replies: [] }]);
      }),
  );
  fireEvent.focus(window);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await act(async () => first());
  expect(engine.setCommentsLoading).toHaveBeenLastCalledWith(true);
  expect(engine.snapshot().commentAnchors).toBeUndefined();
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => second());
  expect(engine.setCommentsLoading).toHaveBeenLastCalledWith(false);
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { [root.url]: { sheetId: "stable", cell: "B3" } },
  });
});

it("falls back to credential-free global fetch for shared reads and refuses every mutation", async () => {
  await seed();
  const publicFetch = vi.fn(pod.fetch);
  const permissions = vi.spyOn(CellCommentStore.prototype, "permissions");
  vi.stubGlobal("fetch", publicFetch);
  sessionState.current = {
    status: "ready",
    session: { storageUrl: "https://pod.example/other/", webId, fetch: vi.fn() },
  };
  render(<WorkbookComments container={container} engine={engine} />);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Root");
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  const scoped = permissions.mock.contexts[0] as CellCommentStore;
  await expect(scoped.create("Blocked", webId, anchor)).rejects.toThrow(
    "This shared spreadsheet is view only.",
  );
  expect(
    publicFetch.mock.calls.every(
      ([, init]) => !init?.method || ["GET", "HEAD"].includes(init.method),
    ),
  ).toBe(true);
  expect(publicFetch.mock.calls.every(([, init]) => init?.credentials === "omit")).toBe(true);
});

it("exposes the Append permission tooltip when its wrapper receives keyboard focus", async () => {
  await seed();
  vi.spyOn(store, "permissions").mockResolvedValue({ append: false, write: false });
  await mount(false);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Root");
  await act(async () => button("Comment").parentElement?.focus());
  expect((await screen.findByRole("tooltip")).textContent).toContain("Append access");
});

it("moves an open draft with its cell and prevents sending after that cell is deleted", async () => {
  await mount();
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Moved draft" } });
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  expect((screen.getByLabelText("Comment on B4") as HTMLTextAreaElement).value).toBe("Moved draft");
  fireEvent.click(button("Send"));
  await screen.findByText("Moved draft");
  expect((await store.list())[0]?.root.anchor?.cell).toBe("B4");
  await waitFor(() => expect((button("Comment") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Deleted draft" } });
  const create = vi.spyOn(store, "create");
  await act(async () =>
    structure({ sheet: "stable", axis: "column", kind: "delete", index: 2, count: 1 }),
  );
  expect(screen.getByRole("alert").textContent).toBe("Cell deleted");
  expect((button("Send") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);
  expect(create).not.toHaveBeenCalled();
});

it("clears a persisted draft before a failed refresh and retries only the refresh", async () => {
  await mount();
  const list = vi.spyOn(store, "list").mockRejectedValueOnce(new Error("Refresh failed"));
  const create = vi.spyOn(store, "create");
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Sent once" } });
  fireEvent.click(button("Send"));
  await screen.findByText("Refresh failed");
  expect(screen.getByRole("status").textContent).toBe("Comment sent.");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.click(button("Retry"));
  await screen.findByText("Sent once");
  expect(create).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(2);
  expect(await store.list()).toHaveLength(1);
});

it("uses each resource's Write hint for claimed authors, independently of container permissions", async () => {
  await seed();
  await store.reply(root, "Foreign creator", "https://other.example/#me");
  const original = store;
  store = new CellCommentStore(container, async (url, init) => {
    const response = await pod.fetch(url, init);
    if (String(url) === root.url)
      response.headers.set("wac-allow", 'public="read write",user="read append"');
    return response;
  });
  const view = await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  await screen.findByText("Foreign creator");
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  view.unmount();
  store = original;
  vi.spyOn(store, "permissions").mockResolvedValue({ append: false, write: false });
  render(<CellComments store={store} engine={engine} webId={webId} local />);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Root");
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  fireEvent.click(button("Edit"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Root");
});

it("uses creation selectors when an engine has no draft tracker and explains an offline edit", async () => {
  delete engine.trackCommentDraft;
  await mount();
  await add("Legacy engine");
  fireEvent.click(button("Edit"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent.change(screen.getByLabelText("Edit comment"), { target: { value: "Offline edit" } });
  expect(button("Send").title).toBe("Reconnect to comment.");
  expect((button("Send") as HTMLButtonElement).disabled).toBe(true);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("retains an in-flight draft through panel closure and registers its moved location after creation", async () => {
  await mount();
  const publish = store.create.bind(store);
  let finish: () => void = () => {};
  vi.spyOn(store, "create").mockImplementationOnce(
    (text, actor, target) =>
      new Promise((resolve) => {
        finish = () => {
          void publish(text, actor, target).then(resolve);
        };
      }),
  );
  fireEvent.click(button("Comment"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "In flight" } });
  fireEvent.click(button("Send"));
  fireEvent.keyDown(window, { key: "m", ctrlKey: true, altKey: true });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("In flight");
  fireEvent.click(button("Close comments"));
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  fireEvent.click(button("Comments (0 on this sheet)"));
  expect(screen.getByLabelText("Comment on B4")).toBeTruthy();
  await act(async () => finish());
  await screen.findByText("In flight");
  expect(button("Renamed sheet!B4")).toBeTruthy();
  expect((await store.list())[0]?.root.anchor?.cell).toBe("B3");
});
