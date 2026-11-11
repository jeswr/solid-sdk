// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import { emptyScene } from "@jeswr/excalidraw-scene";
import { StorageError } from "@jeswr/storage-client";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardList } from "../src/apps/whiteboard/components/board-list";
import { BoardEditor } from "../src/apps/whiteboard/components/editor";
import { WhiteboardApp } from "../src/apps/whiteboard/components/whiteboard-app";
import { activateDraftOwner, readDrafts, writeDrafts } from "../src/apps/whiteboard/lib/drafts";
import type { Board } from "../src/apps/whiteboard/lib/repository";
import { BoardAutosave } from "../src/apps/whiteboard/state/autosave";

// Exercise app callbacks and effects without a browser dependency. Each driver owns its hooks.
const runtime = vi.hoisted(() => ({
  current: null as unknown as Driver,
  accounts: null as unknown,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => runtime.current.state(initial),
    useRef: (initial: unknown) => runtime.current.ref(initial),
    useEffect: (effect: () => undefined | (() => void), deps: unknown[]) =>
      runtime.current.effect(effect, deps),
    useLayoutEffect: (effect: () => undefined | (() => void), deps: unknown[]) =>
      runtime.current.effect(effect, deps),
    useMemo: (fn: () => unknown, deps: unknown[]) => runtime.current.memo(fn, deps),
    useCallback: (fn: unknown, deps: unknown[]) => runtime.current.memo(() => fn, deps),
  };
});
const pod = vi.hoisted(() => ({
  webId: "https://fictional.example/me",
  storageUrl: "https://fictional.example/pod/",
  mode: "solid",
}));
const repo = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  unreadable: [],
  truncated: false,
}));
const notices = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }));
vi.mock("@jeswr/suite-ui", () =>
  Object.fromEntries([
    ...[
      "Button",
      "Dialog",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogTitle",
      "EmptyState",
      "ErrorState",
      "LoadingSkeleton",
      "Toaster",
      "IconButton",
      "Input",
      "Textarea",
    ].map((name) => [name, name]),
    ["toast", notices],
  ]),
);
vi.mock("@/shell/app-frame", () => ({
  AppFrame: "app-frame",
  AppHeading: "h1",
  AppSessionGuard: "session-guard",
}));
vi.mock("@/shell/session/accounts-context", () => ({
  useOptionalAccounts: () => runtime.accounts,
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: "pod-session",
  usePodSessionState: () => ({ status: "ready", session: pod }),
}));
vi.mock("../src/apps/whiteboard/lib/repository", async (original) => ({
  ...(await original<typeof import("../src/apps/whiteboard/lib/repository")>()),
  openWhiteboards: async () => repo,
}));

class Driver {
  slots: unknown[] = [];
  index = 0;
  effects: (() => void)[] = [];
  cleanups = new Map<number, () => void>();
  render<P>(component: (props: P) => ReactNode, props: P): ReactNode {
    runtime.current = this;
    this.index = 0;
    const tree = component(props);
    for (const run of this.effects.splice(0)) run();
    return tree;
  }
  state(initial: unknown) {
    const index = this.index++;
    if (!(index in this.slots))
      this.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      this.slots[index],
      (value: unknown) => {
        this.slots[index] = typeof value === "function" ? value(this.slots[index]) : value;
      },
    ];
  }
  ref(initial: unknown) {
    const index = this.index++;
    if (!(index in this.slots)) this.slots[index] = { current: initial };
    return this.slots[index];
  }
  memo(fn: () => unknown, deps: unknown[]) {
    const index = this.index++;
    const old = this.slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || deps.some((v, i) => !Object.is(v, old.deps[i])))
      this.slots[index] = { deps, value: fn() };
    return (this.slots[index] as { value: unknown }).value;
  }
  effect(fn: () => undefined | (() => void), deps: unknown[]) {
    const index = this.index++;
    const old = this.slots[index] as unknown[] | undefined;
    if (!old || deps.some((v, i) => !Object.is(v, old[i]))) {
      this.slots[index] = deps;
      this.effects.push(() => {
        this.cleanups.get(index)?.();
        const cleanup = fn();
        if (cleanup) this.cleanups.set(index, cleanup);
      });
    }
  }
  unmount() {
    for (const cleanup of this.cleanups.values()) cleanup();
  }
}
type Node = ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function find(tree: ReactNode, type: unknown, text?: string): Node {
  const node = nodes(tree).find(
    (n) => n.type === type && (text === undefined || n.props.children === text),
  );
  if (!node) throw new Error(`Missing component ${String(type)} ${text ?? ""}`);
  return node;
}
const board: Board = {
  id: "board",
  title: "Ideas",
  scene: emptyScene(),
  descriptor: "board",
  blob: "blob",
  etag: '"canvas"',
  descriptorEtag: '"metadata"',
  metadata: { sceneDocument: "blob" },
};
function storage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
async function mount() {
  vi.stubGlobal("localStorage", storage());
  repo.list.mockResolvedValue([board]);
  const outer = new Driver().render(WhiteboardApp, {});
  const gate = nodes(outer).find(
    (n) => typeof n.type === "function" && n.type.name === "SessionGate",
  ) as Node;
  const child = new Driver().render(gate.type as () => ReactNode, {}) as Node;
  const driver = new Driver();
  const render = () => driver.render(child.type as (props: unknown) => ReactNode, child.props);
  let tree = render();
  await vi.waitFor(() => {
    tree = render();
    expect(find(tree, BoardList).props.boards).toEqual([board]);
  });
  return { driver, render };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  runtime.accounts = null;
});

it.each([
  "rename",
  "remove",
] as const)("%s of a remotely deleted board drops its draft and permits copy or dismissal", async (operation) => {
  const { render } = await mount();
  repo[operation].mockRejectedValueOnce(
    new StorageError("precondition-failed", { method: "PUT", url: board.id }),
  );
  repo.read.mockRejectedValueOnce(new StorageError("not-found", { method: "GET", url: board.id }));
  const list = find(render(), BoardList).props as unknown as ComponentProps<typeof BoardList>;
  if (operation === "rename") list.onRename(board, "New name");
  else list.onDelete(board);
  await vi.waitFor(() => {
    const tree = render();
    expect(find(tree, "Dialog").props.open).toBe(true);
    expect(find(tree, BoardList).props.boards).toEqual([]);
    expect(readDrafts(localStorage, pod.webId, pod.storageUrl)).toEqual([]);
  });
  const copy = find(render(), "Button", "Keep a copy");
  expect(copy.props.disabled).not.toBe(true);
  expect(find(render(), "DialogContent").props.onEscapeKeyDown).toBeUndefined();
  (find(render(), "Button", "Dismiss").props.onClick as () => void)();
  expect(find(render(), "Dialog").props.open).toBe(false);
});

it("keeps copying available when the remote version cannot be read", async () => {
  const { render } = await mount();
  repo.rename.mockRejectedValueOnce(
    new StorageError("precondition-failed", { method: "PUT", url: board.id }),
  );
  repo.read.mockRejectedValueOnce(new Error("offline"));
  const list = find(render(), BoardList).props as unknown as ComponentProps<typeof BoardList>;
  list.onRename(board, "Local name");
  await vi.waitFor(() => expect(find(render(), "Dialog").props.open).toBe(true));
  const copy = find(render(), "Button", "Keep a copy");
  expect(copy.props.disabled).not.toBe(true);
  repo.create.mockResolvedValueOnce({ ...board, id: "copy" });
  (copy.props.onClick as () => void)();
  await vi.waitFor(() =>
    expect(repo.create).toHaveBeenCalledWith("Local name — copy", board.scene),
  );
});

it("removes a retired writer without removing a newer registration for the same board", async () => {
  const { render } = await mount();
  (find(render(), BoardList).props.onOpen as (b: Board) => void)(board);
  const editor = find(render(), BoardEditor).props as unknown as ComponentProps<typeof BoardEditor>;
  const stale = new BoardAutosave(repo, board, vi.fn());
  const fresh = new BoardAutosave(repo, { ...board, etag: '"fresh"' }, vi.fn());
  const staleFinish = vi.spyOn(stale, "finish");
  const freshFinish = vi.spyOn(fresh, "finish");
  const unregister = editor.onWriter?.(board.id, stale);
  const unregisterFresh = editor.onWriter?.(board.id, fresh);
  unregister?.();
  editor.onBack();
  repo.remove.mockResolvedValueOnce(undefined);
  (find(render(), BoardList).props.onDelete as (b: Board) => void)(board);
  await vi.waitFor(() => expect(repo.remove).toHaveBeenCalledWith({ ...board, etag: '"fresh"' }));
  expect(staleFinish).not.toHaveBeenCalled();
  expect(freshFinish).toHaveBeenCalledOnce();
  unregisterFresh?.();
});

it("does not call a stale writer or show quota errors after account fencing", async () => {
  const { render } = await mount();
  (find(render(), BoardList).props.onOpen as (b: Board) => void)(board);
  const editor = find(render(), BoardEditor).props as unknown as ComponentProps<typeof BoardEditor>;
  activateDraftOwner(localStorage, "other");
  editor.retain(board, true);
  expect(notices.error).not.toHaveBeenCalledWith(
    "Local storage is full. Keep this tab open or export your board.",
  );
});

it("keeps both signed-in accounts' drafts on switch, then purges only the account signing out", () => {
  vi.stubGlobal("localStorage", storage());
  const alice = { webId: "alice" },
    bob = { webId: "bob" };
  activateDraftOwner(localStorage, "alice");
  writeDrafts(localStorage, "alice", pod.storageUrl, [board]);
  activateDraftOwner(localStorage, "bob");
  writeDrafts(localStorage, "bob", pod.storageUrl, [board]);
  const driver = new Driver();
  runtime.accounts = { status: "ready", accounts: [alice, bob], active: alice };
  driver.render(WhiteboardApp, {});
  runtime.accounts = { status: "ready", accounts: [alice, bob], active: bob };
  driver.render(WhiteboardApp, {});
  expect(readDrafts(localStorage, "alice", pod.storageUrl)).toEqual([board]);
  expect(readDrafts(localStorage, "bob", pod.storageUrl)).toEqual([board]);
  runtime.accounts = { status: "ready", accounts: [bob], active: bob };
  driver.render(WhiteboardApp, {});
  expect(readDrafts(localStorage, "bob", pod.storageUrl)).toEqual([board]);
  expect(readDrafts(localStorage, "alice", pod.storageUrl)).toEqual([]);
});

it("memoises thumbnail SVGs across unrelated list rerenders and regenerates edited scenes", async () => {
  const sceneModule = await import("@jeswr/excalidraw-scene");
  const svg = vi.spyOn(sceneModule, "sceneToSvg");
  const list = new Driver();
  const props: ComponentProps<typeof BoardList> = {
    boards: [board],
    ready: true,
    onOpen() {},
    onCreate() {},
    onRename() {},
    onDelete() {},
  };
  const thumbnail = (tree: ReactNode) =>
    nodes(tree).find((n) => n.type && typeof n.type === "object" && "type" in n.type) as Node;
  const component = thumbnail(list.render(BoardList, props));
  const image = new Driver();
  const render = (element: Node) =>
    image.render(
      (element.type as unknown as { type: (props: unknown) => ReactNode }).type,
      element.props,
    );
  render(component);
  render(thumbnail(list.render(BoardList, { ...props, ready: false })));
  expect(svg).toHaveBeenCalledTimes(1);
  render(
    thumbnail(
      list.render(BoardList, {
        ...props,
        boards: [
          { ...board, scene: { ...emptyScene(), appState: { viewBackgroundColor: "red" } } },
        ],
      }),
    ),
  );
  expect(svg).toHaveBeenCalledTimes(2);
  svg.mockRestore();
});

it("unregisters an unmounted editor after its teardown flush settles", async () => {
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  const unregister = vi.fn();
  let writer: BoardAutosave | undefined;
  const props: ComponentProps<typeof BoardEditor> = {
    board,
    repository: repo,
    onBack() {},
    onChange() {},
    retain() {},
    onCopy() {},
    hasDraft: false,
    onWriter(_id, value) {
      writer = value;
      return unregister;
    },
  };
  const driver = new Driver();
  driver.render(BoardEditor, props);
  const gate = Promise.withResolvers<Board>();
  repo.save.mockReturnValueOnce(gate.promise);
  writer?.update(emptyScene());
  driver.unmount();
  expect(unregister).not.toHaveBeenCalled();
  gate.resolve({ ...board, etag: '"saved"' });
  await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
});

it("unregisters an editor writer when its conflict is resolved before returning to the list", async () => {
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  const unregister = vi.fn();
  let writer: BoardAutosave | undefined;
  const props: ComponentProps<typeof BoardEditor> = {
    board,
    repository: repo,
    onBack: vi.fn(),
    onChange() {},
    retain() {},
    onCopy() {},
    hasDraft: false,
    onWriter(_id, value) {
      writer = value;
      return unregister;
    },
  };
  const driver = new Driver();
  const render = () => driver.render(BoardEditor, props);
  render();
  repo.save.mockRejectedValueOnce(
    new StorageError("precondition-failed", { method: "PUT", url: board.id }),
  );
  repo.read.mockResolvedValueOnce({ ...board, etag: '"remote"' });
  writer?.update(emptyScene());
  await writer?.flush();
  await vi.waitFor(() =>
    expect(find(render(), "Button", "Reload board").props.disabled).toBe(false),
  );
  (find(render(), "Button", "Reload board").props.onClick as () => void)();
  await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  expect(props.onBack).toHaveBeenCalledOnce();
  driver.unmount();
});
