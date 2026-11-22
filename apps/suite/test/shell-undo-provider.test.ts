// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { act, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, render, fireEvent, screen } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const state = vi.hoisted(() => ({
  pathname: "/tasks/today",
  account: { id: "alice", webId: "https://alice.example/me" } as {
    id: string;
    webId: string;
  } | null,
  status: "ready",
  live: true,
  notify: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({
    active: state.account,
    status: state.status,
    isActiveAccount: (id: string) =>
      state.live && id === state.account?.id && state.status === "ready",
  }),
}));
vi.mock("@jeswr/suite-ui", () => ({ toast: state.notify }));

import { ShortcutsProvider, useRegisteredShortcuts } from "../src/shell/shortcuts/provider";
import { UndoProvider, undoScope, useUndo } from "../src/shell/undo/provider";
import { UndoShortcuts } from "../src/shell/undo/shortcuts";

let actions: ReturnType<typeof useUndo>;
let registered: ReturnType<typeof useRegisteredShortcuts>;
function Probe() {
  actions = useUndo();
  registered = useRegisteredShortcuts();
  const [draft, setDraft] = useState("");
  return h("input", {
    "aria-label": "draft",
    value: draft,
    onChange: (e) => setDraft(e.currentTarget.value),
  });
}
const tree = (platform = "Linux") =>
  h(UndoProvider, {
    children: h(ShortcutsProvider, {
      platform,
      children: [h(UndoShortcuts, { key: "keys" }), h(Probe, { key: "probe" })],
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.pathname = "/tasks/today";
  state.account = { id: "alice", webId: "https://alice.example/me" };
  state.status = "ready";
  state.live = true;
  let id = 0;
  state.notify.mockImplementation(() => ++id);
  state.notify.success.mockImplementation(() => ++id);
  state.notify.error.mockImplementation(() => ++id);
});
afterEach(cleanup);
const keyboard = async (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};
it.each([
  [null, "home"],
  ["/", "home"],
  ["/tasks/today", "tasks"],
  ["/drive/my/folder", "drive"],
  ["/notifications", "notifications"],
])("derives scope for %s", (path, scope) => {
  expect(undoScope(path)).toBe(scope);
});
it("scopes actions by route, targets toast IDs, and registers settings commands", async () => {
  const view = render(tree());
  const first = vi.fn(async () => {}),
    second = vi.fn(async () => {}),
    redo = vi.fn(async () => {});
  actions.push({ label: "Task completed", undo: first, redo });
  actions.push({ label: "Another task", undo: second });
  expect(state.notify).toHaveBeenCalledWith(
    "Task completed",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  const action = state.notify.mock.calls[0]?.[1].action;
  state.pathname = "/drive/my";
  view.rerender(tree());
  expect(await actions.undo()).toEqual({ status: "nothing" });
  await act(async () => {
    action.onClick();
  });
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  expect(state.notify.success).toHaveBeenCalledWith("Undone", expect.any(Object));
  state.pathname = "/tasks/inbox";
  view.rerender(tree());
  await actions.redo();
  expect(redo).toHaveBeenCalledOnce();
  expect(registered).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "global.undo", keys: "Cmd/Ctrl+Z" }),
      expect.objectContaining({ id: "global.redo", keys: "Cmd/Ctrl+Shift+Z" }),
    ]),
  );
});
it.each([
  "Linux",
  "MacIntel",
])("handles undo/redo on %s with native text undo preserved", async (platform) => {
  render(tree(platform));
  const undo = vi.fn(async () => {}),
    redo = vi.fn(async () => {});
  actions.push({ label: "Changed", undo, redo });
  const modifier = platform === "Linux" ? { ctrlKey: true } : { metaKey: true };
  for (const tag of ["input", "textarea", "select", "div"]) {
    const element = document.createElement(tag);
    if (tag === "div") element.setAttribute("contenteditable", "true");
    const target = tag === "div" ? element.appendChild(document.createElement("span")) : element;
    document.body.appendChild(element);
    expect((await keyboard(target, modifier)).defaultPrevented).toBe(false);
    expect((await keyboard(target, { ...modifier, shiftKey: true })).defaultPrevented).toBe(false);
    element.remove();
  }
  expect(undo).not.toHaveBeenCalled();
  expect((await keyboard(document.body, modifier)).defaultPrevented).toBe(true);
  expect(undo).toHaveBeenCalledOnce();
  await keyboard(document.body, { ...modifier, shiftKey: true });
  expect(redo).toHaveBeenCalledOnce();
  await keyboard(document.body, { ...modifier, altKey: true });
  await keyboard(document.body, { ...modifier, repeat: true });
  await keyboard(document.body, { ...modifier, isComposing: true });
  expect(undo).toHaveBeenCalledOnce();
});
it.each([
  "switch",
  "sign-out",
  "expiry",
  "webid",
])("clears history, aborts pending work, retires toast actions and preserves children on %s", async (change) => {
  const view = render(tree());
  const wait = deferred<void>();
  const undo = vi.fn((_signal: AbortSignal) => wait.promise);
  actions.push({ label: "Private change", undo, redo: async () => {} });
  const retained = actions;
  const toastAction = state.notify.mock.calls[0]?.[1].action;
  const pending = actions.undo();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsaved" } });
  if (change === "switch") state.account = { id: "bob", webId: "https://bob.example/me" };
  if (change === "sign-out") {
    state.account = null;
    state.status = "signed-out";
  }
  if (change === "expiry") state.status = "expired";
  if (change === "webid") state.account = { id: "alice", webId: "https://changed.example/me" };
  view.rerender(tree());
  expect(undo.mock.calls[0]?.[0].aborted).toBe(true);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("unsaved");
  expect(state.notify.dismiss).toHaveBeenCalled();
  expect(retained.push({ label: "stale", undo: async () => {} })).toBe("");
  await act(async () => {
    toastAction.onClick();
    wait.resolve();
    await pending;
  });
  expect(undo).toHaveBeenCalledOnce();
  expect(state.notify.success).not.toHaveBeenCalled();
  state.account = { id: "alice", webId: "https://alice.example/me" };
  state.status = "ready";
  view.rerender(tree());
  expect(await actions.undo()).toEqual({ status: "nothing" });
  expect(await retained.undo()).toEqual({ status: "nothing" });
});
it("fences a live account change before render and reports short failures", async () => {
  render(tree());
  const undo = vi.fn(async () => {
    throw new Error("secret transport details");
  });
  actions.push({ label: "Changed", undo });
  state.live = false;
  expect(await actions.undo()).toEqual({ status: "nothing" });
  expect(undo).not.toHaveBeenCalled();
  state.live = true;
  expect((await actions.undo()).status).toBe("failed");
  expect(state.notify.error).toHaveBeenCalledWith("Couldn't undo this change.", expect.any(Object));
  actions.push({ label: "Expired", expiresAt: 0, undo });
  await act(async () => {
    state.notify.mock.calls.at(-1)?.[1].action.onClick();
  });
  expect(undo).toHaveBeenCalledOnce();
});
it("requires the shell provider", () => {
  expect(() => render(h(Probe))).toThrow("useUndo requires UndoProvider");
});

it("notification actions register their label and inverse with the shared shell stack", async () => {
  const { NotificationSessionProvider, useNotifications } = await import(
    "../src/shell/notifications/provider"
  );
  const { createDemoNotificationSource } = await import("../src/shell/notifications/demo-source");
  let notifications!: ReturnType<typeof useNotifications>;
  function NotificationsProbe() {
    notifications = useNotifications();
    actions = useUndo();
    return null;
  }
  render(
    h(UndoProvider, {
      children: h(NotificationSessionProvider, {
        accountId: "alice",
        sources: [createDemoNotificationSource()],
        children: h(NotificationsProbe),
      }),
    }),
  );
  await act(async () => {
    await notifications.refresh();
  });
  const previous = notifications.items;
  const first = previous[0];
  if (!first) throw new Error("Expected a notification");
  await act(async () => {
    notifications.dismiss(first.id);
  });
  expect(state.notify).toHaveBeenLastCalledWith("Notification dismissed", expect.any(Object));
  expect(notifications.items).toHaveLength(previous.length - 1);
  await act(async () => {
    await actions.undo();
  });
  expect(notifications.items).toEqual(previous);
  await act(async () => {
    await notifications.markAllRead();
  });
  expect(state.notify).toHaveBeenLastCalledWith(
    "Marked 4 notifications as read",
    expect.any(Object),
  );
  await act(async () => {
    await actions.undo();
  });
  expect(notifications.items).toEqual(previous);
});
