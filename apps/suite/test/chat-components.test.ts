// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Message } from "../src/apps/chat/lib/client";
import { PreferencesStore } from "../src/apps/chat/lib/client/preferences-store";
import { ChatProvider, type ChatSession, useChat } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/chat/components/chat-app", () => ({
  useProfile: (id: string) => ({
    displayName: id.includes("bob") ? "Bob" : "Alice",
    loading: false,
  }),
  PersonName: ({ webId }: { webId: string }) => webId,
  RoomName: ({ room }: { room: { name: string } }) => room.name,
  ChatFailure: () => h("p", { role: "alert" }, "Can't open this room"),
  ChatEmpty: () => h("p", null, "No conversations yet"),
}));
const routing = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));

import { Composer } from "../src/apps/chat/components/composer";
import { MessageText } from "../src/apps/chat/components/message-text";
import { NewRoomPage } from "../src/apps/chat/components/new-room";
import { RoomRoute, RoomView } from "../src/apps/chat/components/room";
import { Timeline } from "../src/apps/chat/components/timeline";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const ROOM = `${ROOT}chat/rooms/test/`;
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const axe = requireUi("axe-core") as {
  run: (node: Element, options: object) => Promise<{ violations: unknown[] }>;
};
function session(pod: ReturnType<typeof createDemoPod>): ChatSession {
  return {
    mode: "demo",
    webId: ME,
    storageUrl: ROOT,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
}
function message(id: string, author = ME, at = new Date()): Message {
  return {
    id: `${ROOM}2026/11/01.ttl#${id}`,
    content: id,
    author,
    published: at.toISOString(),
    mediaType: "text/plain",
    updated: undefined,
    tombstone: false,
    deleted: false,
    edited: false,
  };
}
const noop = () => {};
const timelineProps = {
  canRewrite: true,
  url: ROOM,
  outgoing: [],
  loading: false,
  hasOlder: true,
  loadOlder: noop,
  onEdit: noop,
  onDelete: noop,
  onTask: noop,
  retry: noop,
  discard: noop,
};
beforeEach(() => {
  localStorage.clear();
  routing.replace.mockClear();
});
afterEach(() => vi.restoreAllMocks());
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}
async function accessible(host: Element) {
  expect(
    (
      await axe.run(host, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
}
it("renders untrusted markdown as React text and only safe external links", () => {
  const html = renderToStaticMarkup(
    h(MessageText, {
      text: "<img src=x onerror=alert(1)> **bold** _italic_ `code` https://example.org/page\n\n> quote\n\n- item\n\n1. first\n\n```\n<script>bad()</script>\n```\n\n[jump](javascript:alert(1))",
    }),
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;img");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain('target="_blank" rel="noopener noreferrer nofollow"');
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<pre>");
});
it("announces incoming messages without announcing history and provides keyboard message menus", async () => {
  const pod = createDemoPod({ root: ROOT });
  const activeSession = session(pod);
  const first = message("hello");
  const view = await mount(
    h(ChatProvider, {
      session: activeSession,
      children: h(Timeline, { ...timelineProps, messages: [first] }),
    }),
  );
  const log = view.host.querySelector('[role="log"]') as HTMLElement;
  expect(log.getAttribute("aria-live")).toBe("polite");
  expect(log.querySelector(".sr-only")?.textContent).toBe("");
  await act(() => log.focus());
  await key(log, "Home");
  await nextFrame();
  const article = log.querySelector("article") as HTMLElement;
  expect(document.activeElement).toBe(article);
  expect(article.getAttribute("aria-label")).toMatch(/^Alice, /);
  await key(article, "Enter");
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Edit");
  await key(document.querySelector('[role="menu"]') as HTMLElement, "Escape");
  const incoming = message(
    "incoming",
    "https://bob.example/profile#me",
    new Date(Date.now() + 1000),
  );
  await view.render(
    h(ChatProvider, {
      session: activeSession,
      children: h(Timeline, { ...timelineProps, messages: [first, incoming] }),
    }),
  );
  expect(log.querySelector(".sr-only")?.textContent).toContain("1 new message. incoming");
  await click(log.querySelector(".chat-history-action button") as Element);
  const older = message(
    "old history",
    "https://bob.example/profile#me",
    new Date(Date.now() - 86400000),
  );
  await view.render(
    h(ChatProvider, {
      session: activeSession,
      children: h(Timeline, { ...timelineProps, messages: [older, first, incoming] }),
    }),
  );
  expect(log.querySelector(".sr-only")?.textContent).not.toContain("old history");
  await accessible(view.host);
});
it("windows long histories and can focus the actual first and last messages", async () => {
  const pod = createDemoPod({ root: ROOT });
  const onRendered = vi.fn();
  const messages = Array.from({ length: 240 }, (_, i) =>
    message(`message-${String(i).padStart(3, "0")}`, ME, new Date(Date.now() + i * 1000)),
  );
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, { ...timelineProps, messages, onRendered }),
    }),
  );
  expect(view.host.querySelectorAll("article")).toHaveLength(200);
  const log = view.host.querySelector('[role="log"]') as HTMLElement;
  await key(log, "Home");
  await nextFrame();
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[0]?.id);
  expect(onRendered).toHaveBeenLastCalledWith(Date.parse(messages[199]?.published as string));
  await key(document.activeElement as HTMLElement, "End");
  await nextFrame();
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[239]?.id);
  expect(onRendered).toHaveBeenLastCalledWith(Date.parse(messages[239]?.published as string));
  await key(document.activeElement as HTMLElement, "ArrowUp");
  await nextFrame();
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[238]?.id);
});
it("composer sends on Enter, preserves Shift+Enter, cancels edits and exposes the last-message shortcut", async () => {
  const pod = createDemoPod({ root: ROOT });
  const edit = vi.fn();
  const send = vi.fn();
  const last = message("Last message");
  const props = { url: ROOM, send, editing: last, onEdit: edit, lastOwn: last };
  const activeSession = session(pod);
  const view = await mount(
    h(ChatProvider, { session: activeSession, children: h(Composer, props) }),
  );
  const textarea = view.host.querySelector("textarea") as HTMLTextAreaElement;
  expect(textarea.value).toBe("Last message");
  await key(textarea, "Escape");
  expect(edit).toHaveBeenCalledWith(undefined);
  await view.render(
    h(ChatProvider, {
      session: activeSession,
      children: h(Composer, { ...props, editing: undefined }),
    }),
  );
  await key(textarea, "ArrowUp");
  expect(edit).toHaveBeenCalledWith(last);
  // Drive's shared harness uses React's native value setter for controlled input.
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      "Two lines",
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(textarea, "Enter", true);
  expect(send).not.toHaveBeenCalled();
  await key(textarea, "Enter");
  expect(send).toHaveBeenCalledWith("Two lines");
  await accessible(view.host);
});
it("mounts the actual room, safe message text, header and new-room dialog without accessibility violations", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Accessible room", members: [] });
  await client.send(room.url, "Hello https://example.org/");
  const activeSession = session(pod);
  const view = await mount(
    h(ChatProvider, { session: activeSession, children: h(RoomView, { url: room.url }) }),
  );
  expect(view.host.querySelector("h1")?.textContent).toBe("Accessible room");
  expect(view.host.querySelectorAll("article")).toHaveLength(1);
  await accessible(view.host);
  await view.render(h(ChatProvider, { session: activeSession, children: h(NewRoomPage) }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New conversation");
  await accessible(document.querySelector('[role="dialog"]') as Element);
});

async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(() => {
    const prototype =
      field.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("rejects external and sibling-pod room routes before making any request", async () => {
  const fetch = vi.fn();
  const activeSession = {
    ...session(createDemoPod({ root: ROOT })),
    storageUrl: `${ROOT}alice/`,
    fetch,
  };
  for (const url of ["https://foreign.example/chat/rooms/a/", `${ROOT}bob/chat/rooms/a/`]) {
    const view = await mount(
      h(ChatProvider, {
        session: activeSession,
        children: h(RoomRoute, { reference: encodeRef(url) }),
      }),
    );
    expect(view.host.textContent).toContain(
      "Opening conversations in other pods arrives with sign-in.",
    );
    expect(fetch).not.toHaveBeenCalled();
    await view.unmount();
  }
});

it("keeps the editor and room drafts through transient refresh errors, recovery and remounts", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Drafts", members: [] });
  let fail: "http" | "network" | undefined;
  const activeSession = {
    ...session(pod),
    fetch: (async (input, init) => {
      if (
        fail &&
        (String(input).endsWith("index.ttl") || String(input).endsWith("chat/rooms.ttl"))
      ) {
        if (fail === "network") throw new TypeError("Network unavailable");
        return new Response(null, { status: 503 });
      }
      return pod.fetch(input, init);
    }) as typeof globalThis.fetch,
  };
  let chat!: ReturnType<typeof useChat>;
  function Probe() {
    chat = useChat();
    return h(RoomView, { url: room.url });
  }
  const view = await mount(h(ChatProvider, { session: activeSession, children: h(Probe) }));
  const field = view.host.querySelector("textarea") as HTMLTextAreaElement;
  await fill(field, "My unsent draft");
  for (const failure of ["http", "network"] as const) {
    fail = failure;
    await act(() => chat.invalidate());
    expect(view.host.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("My unsent draft");
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
  }
  fail = undefined;
  await act(() => chat.invalidate());
  expect(view.host.querySelector("textarea")).toBe(field);
  await view.unmount();
  const reopened = await mount(h(ChatProvider, { session: activeSession, children: h(Probe) }));
  expect(reopened.host.querySelector("textarea")?.value).toBe("My unsent draft");
  await reopened.render(
    h(ChatProvider, {
      session: activeSession,
      children: h(Composer, {
        url: `${ROOT}chat/rooms/other/`,
        send: noop,
        editing: undefined,
        onEdit: noop,
        lastOwn: undefined,
      }),
    }),
  );
  expect(reopened.host.querySelector("textarea")?.value).toBe("");
});

it("members' message menus explain write access and never offer edit/delete or the edit shortcut", async () => {
  const pod = createDemoPod({ root: ROOT });
  const owner = new ChatClient(pod.fetch, ROOT, "https://bob.example/#me");
  const room = await owner.createRoom({ name: "Append only", members: [ME] });
  const member = new ChatClient(pod.fetch, ROOT, ME);
  await member.send(room.url, "Member message");
  const view = await mount(
    h(ChatProvider, { session: session(pod), children: h(RoomView, { url: room.url }) }),
  );
  const field = view.host.querySelector("textarea") as HTMLTextAreaElement;
  await key(field, "ArrowUp");
  expect(field.value).toBe("");
  const log = view.host.querySelector('[role="log"]') as HTMLElement;
  await key(log, "Home");
  await nextFrame();
  await key(log.querySelector("article") as HTMLElement, "Enter");
  const menu = document.querySelector('[role="menu"]') as HTMLElement;
  expect(menu.textContent).toContain("Editing needs write access to this room");
  expect(menu.textContent).toContain("Turn into task");
  expect(
    [...menu.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent),
  ).not.toContain("Edit");
  expect(menu.textContent).not.toContain("Delete");
});

it("advances read receipts only to the newest rendered message, never to the current clock", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Receipts", members: [] });
  const at = new Date(Date.now() - 60_000);
  await client.send(room.url, "A minute ago", { at });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const markRead = vi.spyOn(PreferencesStore.prototype, "markRead").mockResolvedValue([]);
  await mount(h(ChatProvider, { session: session(pod), children: h(RoomView, { url: room.url }) }));
  expect(markRead).toHaveBeenCalledWith(room.url, at);
  expect(markRead).toHaveBeenCalledTimes(1);
});

it("adds a DM partner with the picker button while preserving input focus until click", async () => {
  const pod = createDemoPod({ root: ROOT });
  await mount(h(ChatProvider, { session: session(pod), children: h(NewRoomPage) }));
  const tab = [...document.querySelectorAll('[role="tab"]')].find(
    (node) => node.textContent === "Direct message",
  ) as HTMLElement;
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  const input = document.querySelector('[role="combobox"]') as HTMLInputElement;
  await act(() => input.focus());
  await fill(input, "https://bob.example.org/profile/card#me");
  const add = document.querySelector(".su-picker-input button") as HTMLButtonElement;
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  await act(() => add.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  await click(add);
  expect(document.querySelector('[aria-label="Selected people"]')?.textContent).toContain("Bob");
  const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  expect(submit.textContent).toBe("Start direct message");
});

it("opens a room with no invitees immediately instead of showing the invite step", async () => {
  const pod = createDemoPod({ root: ROOT });
  await mount(h(ChatProvider, { session: session(pod), children: h(NewRoomPage) }));
  const input = document.querySelector('input[placeholder="e.g. Book club"]') as HTMLInputElement;
  await fill(input, "Just me");
  await click(document.querySelector('button[type="submit"]') as HTMLButtonElement);
  expect(routing.replace).toHaveBeenCalledWith(
    `/chat/r/${encodeRef(`${ROOT}chat/rooms/just-me/`)}`,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Invite people");
});
