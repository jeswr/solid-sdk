// AUTHORED-BY Codex GPT-6.1-Sol
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
  engine = {
    selectedCell: () => anchor,
    selectCell: vi.fn(),
    onSelection: (listener: (anchor: CellAnchor | undefined) => void) => {
      select = listener;
      return unselect;
    },
    onStructure: (listener: (edit: StructuralEdit) => void) => {
      structure = listener;
      return unstructure;
    },
    snapshot: () => ({ sheets: { stable: { name: "Renamed sheet" } } }),
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
  expect((button("Renamed sheet!B5") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => select({ ...anchor, sheetId: "other" }));
  expect(button("Comments (0 on this sheet)")).toBeTruthy();
});
it("allows append-only comments on view-only grids while disabling changes to existing comments", async () => {
  await seed();
  vi.spyOn(store, "permissions").mockResolvedValue({ append: true, write: false });
  await mount();
  fireEvent.click(button("Comments (1 on this sheet)"));
  expect((button("Edit") as HTMLButtonElement).disabled).toBe(true);
  expect(button("Delete").title).toContain("Write access");
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
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
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
it("reports load and structural failures and ignores late loads and mutations after unmount", async () => {
  const list = vi.spyOn(store, "list").mockRejectedValueOnce(new Error("Can't load"));
  const view = render(<CellComments store={store} engine={engine} webId={webId} local />);
  fireEvent.click(button("Comments (0 on this sheet)"));
  await screen.findByText("Can't load");
  fireEvent.click(button("Refresh comments"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  vi.spyOn(store, "shift").mockRejectedValueOnce(new Error("Conflict"));
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  await screen.findByText(/Couldn't move comment anchors/);
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

it("fences successful and failed actions plus failed anchor shifts after closing the workbook", async () => {
  for (const fail of [false, true]) {
    const view = await mount();
    let finish: () => void = () => {};
    vi.spyOn(store, "create").mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => (fail ? reject(new Error("Late write")) : resolve(root));
        }),
    );
    fireEvent.click(button("Comment"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Pending" } });
    fireEvent.click(button("Send"));
    await act(async () => {});
    view.unmount();
    await act(async () => finish());
  }
  const view = await mount();
  let fail: () => void = () => {};
  vi.spyOn(store, "shift").mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = () => reject(new Error("Late shift"));
      }),
  );
  await act(async () =>
    structure({ sheet: "stable", axis: "row", kind: "insert", index: 1, count: 1 }),
  );
  view.unmount();
  await act(async () => fail());
});

it("falls back to credential-free global fetch for shared reads and refuses every mutation", async () => {
  await seed();
  const publicFetch = vi.fn(pod.fetch);
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
  await screen.findByText(/This shared spreadsheet is view only/);
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
