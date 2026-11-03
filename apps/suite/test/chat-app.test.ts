// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import type { ChatSession } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, click, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as ChatSession | undefined,
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mocks.session }),
}));

import { ChatApp, ChatLanding } from "../src/apps/chat/components/chat-app";
import { RoomView } from "../src/apps/chat/components/room";
import { ChatSearchPage } from "../src/apps/chat/components/search";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const axe = requireUi("axe-core") as {
  run: (node: Element, options: object) => Promise<{ violations: unknown[] }>;
};
async function accessible(node: Element) {
  expect(
    (
      await axe.run(node, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
}
function setup(live = true) {
  const pod = createDemoPod({ root: ROOT });
  mocks.session = {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: ROOT,
    webId: ME,
    displayName: "Alice",
    reset: async () => {},
    ...(live ? { subscribe: pod.subscribe } : {}),
  };
  return new ChatClient(pod.fetch, ROOT, ME);
}
afterEach(() => {
  vi.restoreAllMocks();
  mocks.push.mockClear();
  localStorage.clear();
});
it("wires the actual session, frame, empty sidebar and empty main with valid heading order", async () => {
  setup();
  const view = await mount(h(ChatApp, { children: h(ChatLanding) }));
  const main = view.host.querySelector("main") as HTMLElement;
  const sidebar = view.host.querySelector('[aria-label="Conversations"]') as HTMLElement;
  expect(main.textContent).toContain("No conversations yet");
  expect(sidebar.textContent).toContain("New room");
  expect(sidebar.textContent).toContain("Rooms");
  expect(sidebar.textContent).toContain("Direct messages");
  expect(sidebar.textContent).not.toContain("No conversations yet");
  await accessible(main);
  await accessible(sidebar);
});
it("renders the polling capability fallback once and keeps unread/read hooks in the actual frame", async () => {
  const client = setup(false);
  const room = await client.createRoom({ name: "Polling room", members: [] });
  await client.send(room.url, "Hello");
  const view = await mount(h(ChatApp, { children: h(RoomView, { url: room.url }) }));
  expect(view.host.querySelectorAll(".chat-room-header .chat-hint")).toHaveLength(1);
  expect(view.host.querySelector(".chat-room-header .chat-hint")?.textContent).toBe(
    "Updates every 30 s",
  );
  expect(view.host.querySelector("main h1")?.textContent).toBe("Polling room");
  expect(view.host.querySelector('[data-slot="badge"]')).toBeNull();
  expect(view.host.textContent).not.toContain("Load earlier messages");
  await accessible(view.host.querySelector("main") as HTMLElement);
});
it("submits sidebar searches and scopes the slash shortcut to non-editable Chat content", async () => {
  setup();
  const view = await mount(h(ChatApp, { children: h(ChatLanding) }));
  const field = view.host.querySelector<HTMLInputElement>(
    '[data-chat-search="sidebar"]',
  ) as HTMLInputElement;
  const main = view.host.querySelector("main") as HTMLElement;
  await act(() => main.focus());
  await key(main, "/");
  expect(document.activeElement).toBe(field);
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  editable.setAttribute("contenteditable", "");
  editable.tabIndex = 0;
  main.append(editable);
  await act(() => editable.focus());
  await key(editable, "/");
  expect(document.activeElement).toBe(editable);
  await act(() => main.focus());
  localStorage.setItem("suite.settings.shortcuts", "off");
  await key(main, "/");
  expect(document.activeElement).toBe(main);
  localStorage.removeItem("suite.settings.shortcuts");
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "garden & books",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Submit after the controlled edit is committed.
  await act(() =>
    field.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.push).toHaveBeenLastCalledWith("/chat/search?q=garden%20%26%20books");
  await view.unmount();
  await key(document.body, "/");
  expect(document.activeElement).not.toBe(field);
});
it("prefers the search page field for slash and renders real client results accessibly", async () => {
  const client = setup();
  const room = await client.createRoom({ name: "Garden club", members: [] });
  await client.send(room.url, "Garden plans");
  const view = await mount(
    h(ChatApp, { children: h(ChatSearchPage, { query: "from:alice garden" }) }),
  );
  const main = view.host.querySelector("main") as HTMLElement;
  const pageField = main.querySelector("input");
  await act(() => main.focus());
  await key(main, "/");
  expect(document.activeElement).toBe(pageField);
  expect(main.querySelector("mark")?.textContent).toBe("Garden");
  expect(view.host.querySelector('search[aria-label="Search messages"]')).not.toBeNull();
  const fields = [...view.host.querySelectorAll<HTMLInputElement>('input[type="search"]')];
  expect(
    fields.map((field) => view.host.querySelector(`label[for="${field.id}"]`)?.textContent),
  ).toEqual(["Search messages", "Search messages in joined rooms"]);
  await accessible(main);
  await click(view.host.querySelector('[aria-label="Open navigation"]') as Element);
  const drawer = document.querySelector('[role="dialog"]') as HTMLElement;
  const drawerField = drawer.querySelector("input");
  const link = drawer.querySelector('a[href="/chat/new"]') as HTMLElement;
  await act(() => link.focus());
  await key(link, "/");
  expect(document.activeElement).toBe(drawerField);
});
it("opens the search page on narrow screens when the sidebar field is hidden", async () => {
  setup();
  const matchMedia = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...matchMedia(query),
    matches: true,
  }));
  const view = await mount(h(ChatApp, { children: h(ChatLanding) }));
  const main = view.host.querySelector("main") as HTMLElement;
  await act(() => main.focus());
  await key(main, "/");
  expect(mocks.push).toHaveBeenCalledWith("/chat/search");
});
it("leaves slash in dialogs, alerts, menus and listboxes and only cancels an acting shortcut", async () => {
  setup();
  const view = await mount(h(ChatApp, { children: h(ChatLanding) }));
  const main = view.host.querySelector("main") as HTMLElement;
  for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
    const popup = document.createElement("div");
    popup.setAttribute("role", role);
    const target = document.createElement("button");
    popup.append(target);
    main.append(popup);
    await act(() => target.focus());
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    await act(() => target.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(target);
    popup.remove();
  }
  await act(() => main.focus());
  const acting = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  await act(() => main.dispatchEvent(acting));
  expect(acting.defaultPrevented).toBe(true);
  view.host.querySelector('[data-chat-search="sidebar"]')?.remove();
  const idle = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  await act(() => main.dispatchEvent(idle));
  expect(idle.defaultPrevented).toBe(false);
});
