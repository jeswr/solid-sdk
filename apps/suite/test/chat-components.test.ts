// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Message, type Room } from "../src/apps/chat/lib/client";
import { PreferencesStore } from "../src/apps/chat/lib/client/preferences-store";
import { ChatProvider, type ChatSession, useChat } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeIdentifierRef, encodeRef } from "../src/lib/refs";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

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
const routing = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routing,
  useSearchParams: () => routing.params,
}));

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
    reactions: [],
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
  routing.params = new URLSearchParams();
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
  // Two presses before React renders still move two rows, and focus moves at once.
  await act(async () => {
    for (let press = 0; press < 2; press++)
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
      );
  });
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[236]?.id);
});
it("reveals a linked message outside the virtual window and briefly highlights it without stealing focus on refresh", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pod = createDemoPod({ root: ROOT });
    const activeSession = session(pod);
    const messages = Array.from({ length: 240 }, (_, i) =>
      message(`linked-${String(i).padStart(3, "0")}`, ME, new Date(Date.now() + i * 1000)),
    );
    const target = messages[0] as Message;
    const scroll = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    const tree = (items: Message[]) =>
      h(ChatProvider, {
        session: activeSession,
        children: h(Timeline, { ...timelineProps, messages: items, messageId: target.id }),
      });
    const view = await mount(tree(messages));
    const article = view.host.querySelector(`[data-message-id="${target.id}"]`) as HTMLElement;
    expect(document.activeElement).toBe(article);
    expect(article.hasAttribute("data-highlighted")).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    const log = view.host.querySelector('[role="log"]') as HTMLElement;
    await act(() => log.focus());
    await view.render(tree([...messages]));
    expect(document.activeElement).toBe(log);
    await act(() => vi.advanceTimersByTime(3000));
    expect(article.hasAttribute("data-highlighted")).toBe(false);
    await view.unmount();
    delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  } finally {
    vi.useRealTimers();
  }
});
it("honours an encoded message reference by paging backwards and focusing the room article", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Search history", members: [] });
  const target = await client.send(room.url, "An older garden plan", {
    at: new Date(Date.now() - 16 * 86400000),
  });
  await client.send(room.url, "A recent message");
  vi.spyOn(ChatClient.prototype, "room").mockResolvedValue({
    ...room,
    created: new Date(Date.now() - 28 * 86400000).toISOString(),
  });
  routing.params.set("message", encodeRef(target.id));
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomRoute, {
        reference: encodeRef(room.url),
      }),
    }),
  );
  expect(view.host.querySelectorAll("article")).toHaveLength(2);
  const article = [...view.host.querySelectorAll<HTMLElement>("article")].find(
    (node) => node.dataset.messageId === target.id,
  );
  expect(document.activeElement).toBe(article);
  expect(article?.hasAttribute("data-highlighted")).toBe(true);
});
it("focuses a linked message whose identifier is not in normalized URL form", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Accents", members: [] });
  const sent = await client.send(room.url, "Un café ?");
  const id = `${sent.id.split("#")[0]}#naïve`;
  const original = ChatClient.prototype.messages;
  vi.spyOn(ChatClient.prototype, "messages").mockImplementation(async function (
    this: ChatClient,
    ...args: Parameters<ChatClient["messages"]>
  ) {
    const page = await original.apply(this, args);
    return { ...page, messages: page.messages.map((item) => ({ ...item, id })) };
  });
  routing.params.set("message", encodeIdentifierRef(id));
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomRoute, { reference: encodeRef(room.url) }),
    }),
  );
  const article = view.host.querySelector<HTMLElement>("article");
  expect(article?.dataset.messageId).toBe(id);
  expect(document.activeElement).toBe(article);
  expect(view.host.textContent).not.toContain("couldn't find");
});
it("ignores a malformed message hint while opening a valid room", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Valid room", members: [] });
  routing.params.set("message", "bad%message");
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomRoute, { reference: encodeRef(room.url) }),
    }),
  );
  expect(view.host.querySelector("h1")?.textContent).toBe("Valid room");
  expect(view.host.textContent).not.toContain("This room link isn't valid");
  expect(view.host.querySelector("textarea")).not.toBeNull();
});
it("suppresses incoming announcements during a deep-link history load", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "History", members: [] });
  const old = message("old", "https://bob.example/#me", new Date(Date.now() - 16 * 86400000));
  const recent = message("recent", ME, new Date());
  vi.spyOn(ChatClient.prototype, "messages").mockImplementation(async (_url, options) => ({
    messages: [
      recent,
      ...((options?.before?.getTime() ?? Date.now()) < Date.now() - 14 * 86400000 ? [old] : []),
    ],
    next: new Date((options?.before?.getTime() ?? Date.now()) - 7 * 86400000),
  }));
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomView, { url: room.url, messageId: old.id }),
    }),
  );
  expect(view.host.querySelectorAll("article")).toHaveLength(2);
  expect(view.host.querySelector('[role="log"] > .sr-only')?.textContent).toBe("");
});
it("scrolls and highlights a delayed target while preserving focus in an editor", async () => {
  const activeSession = session(createDemoPod({ root: ROOT }));
  const target = message("delayed", ME, new Date());
  const scroll = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const tree = (messages: Message[]) =>
    h(ChatProvider, {
      session: activeSession,
      children: h(
        "div",
        null,
        h("textarea", { "aria-label": "Draft" }),
        h(Timeline, { ...timelineProps, messages, messageId: target.id }),
      ),
    });
  const view = await mount(tree([]));
  const field = view.host.querySelector("textarea") as HTMLTextAreaElement;
  await act(() => field.focus());
  await view.render(tree([target]));
  expect(document.activeElement).toBe(field);
  expect(view.host.querySelector("article")?.hasAttribute("data-highlighted")).toBe(true);
  expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});
it("keeps the message notice live region mounted while room metadata is loading", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Slow metadata", members: [] });
  const pending = deferred<Room>();
  vi.spyOn(ChatClient.prototype, "room").mockReturnValue(pending.promise);
  vi.spyOn(ChatClient.prototype, "messages").mockResolvedValue({ messages: [], next: null });
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomView, {
        url: room.url,
        messageId: `${room.url}day#missing`,
      }),
    }),
  );
  const status = view.host.querySelector(".chat-message-notice");
  expect(status?.textContent).toContain("This message couldn't be found");
  await act(() => pending.resolve(room));
  expect(view.host.querySelector("h1")?.textContent).toBe("Slow metadata");
  expect(view.host.querySelector(".chat-message-notice")).toBe(status);
});
it("bounds missing-message history loads to four older pages and announces an unavailable target", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Missing target", members: [] });
  const loads = vi
    .spyOn(ChatClient.prototype, "messages")
    .mockImplementation(async (_url, options) => ({
      messages: [],
      next: new Date((options?.before?.getTime() ?? Date.now()) - 7 * 86400000),
    }));
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomView, { url: room.url }),
    }),
  );
  const notice = view.host.querySelector(".chat-message-notice");
  expect(notice?.textContent).toBe("");
  await view.render(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomView, { url: room.url, messageId: `${room.url}2026/01/01.ttl#absent` }),
    }),
  );
  expect(view.host.textContent).toContain("This message couldn't be found in the loaded history.");
  expect(view.host.querySelector(".chat-message-notice")).toBe(notice);
  const earliest = Math.min(
    ...loads.mock.calls.map(([, options]) => options?.before?.getTime() ?? Date.now()),
  );
  expect(earliest).toBeGreaterThanOrEqual(Date.now() - 28 * 86400000 - 1000);
  expect(earliest).toBeLessThan(Date.now() - 27 * 86400000);
  expect(loads.mock.calls.length).toBeLessThanOrEqual(20);
  await accessible(view.host);
});
it("renders named pressed/unpressed reaction chips and toggles through the invalidating action", async () => {
  const pod = createDemoPod({ root: ROOT });
  const react = vi.spyOn(ChatClient.prototype, "react").mockResolvedValue();
  const item = {
    ...message("reactions"),
    reactions: [
      { emoji: "👍", count: 2, reactedByMe: true },
      { emoji: "🎉", count: 1, reactedByMe: false },
    ],
  };
  let revision = 0;
  function View() {
    revision = useChat().revision;
    return h(Timeline, { ...timelineProps, messages: [item] });
  }
  const view = await mount(h(ChatProvider, { session: session(pod), children: h(View) }));
  const chips = view.host.querySelectorAll<HTMLButtonElement>(".chat-reaction");
  expect(chips).toHaveLength(2);
  expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
  expect(chips[0]?.getAttribute("aria-label")).toBe("👍 2 reactions, including you");
  expect(chips[1]?.getAttribute("aria-pressed")).toBe("false");
  expect(chips[1]?.getAttribute("aria-label")).toBe("🎉 1 reaction");
  await click(chips[0] as Element);
  expect(react).toHaveBeenCalledWith(ROOM, item.id, "👍");
  expect(revision).toBe(1);
  await click(chips[1] as Element);
  expect(react).toHaveBeenLastCalledWith(ROOM, item.id, "🎉");
  expect(revision).toBe(2);
  await accessible(view.host);
});
it("adds reactions from the compact picker and restores focus on Escape", async () => {
  const pod = createDemoPod({ root: ROOT });
  const react = vi.spyOn(ChatClient.prototype, "react").mockResolvedValue();
  const item = message("picker");
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, { ...timelineProps, messages: [item] }),
    }),
  );
  const trigger = view.host.querySelector('[aria-label="Add reaction"]') as HTMLButtonElement;
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  let menu = document.querySelector('[role="menu"][aria-label="Add reaction"]') as HTMLElement;
  const choices = [...menu.querySelectorAll('[role="menuitem"]')];
  expect(choices.map((item) => item.textContent)).toEqual([
    "👍",
    "❤️",
    "😂",
    "🎉",
    "😮",
    "😢",
    "🙏",
    "👀",
  ]);
  await key(choices[0] as Element, "Escape");
  await nextFrame();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await key(trigger, "ArrowDown");
  menu = document.querySelector('[role="menu"][aria-label="Add reaction"]') as HTMLElement;
  const thumbsUp = [...menu.querySelectorAll('[role="menuitem"]')].find(
    (choice) => choice.getAttribute("aria-label") === "React with 👍",
  );
  expect(thumbsUp).toBeDefined();
  await click(thumbsUp as Element);
  expect(react).toHaveBeenCalledWith(ROOM, item.id, "👍");
  await nextFrame();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  const actions = view.host.querySelector('[aria-label="Message actions"]') as HTMLButtonElement;
  await act(() => actions.focus());
  await key(actions, "ArrowDown");
  const add = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.startsWith("Add reaction"),
  ) as HTMLElement;
  await act(() => add.focus());
  await key(add, "ArrowRight");
  const heart = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (choice) => choice.getAttribute("aria-label") === "React with ❤️",
  ) as HTMLElement;
  expect(heart).toBeDefined();
  await key(heart, "Escape");
  await nextFrame();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(actions);
  await act(() => (view.host.querySelector('[role="log"]') as HTMLElement).focus());
  await accessible(view.host);
});
it("keeps keyboard focus in the message after picking a reaction and when its last chip disappears", async () => {
  const pod = createDemoPod({ root: ROOT });
  const react = vi.spyOn(ChatClient.prototype, "react").mockResolvedValue();
  const active = session(pod);
  const base = message("focus");
  const tree = (reactions: Message["reactions"]) =>
    h(ChatProvider, {
      session: active,
      children: h(Timeline, { ...timelineProps, messages: [{ ...base, reactions }] }),
    });
  const view = await mount(tree([{ emoji: "👍", count: 1, reactedByMe: true }]));
  const trigger = view.host.querySelector('[aria-label="Add reaction"]') as HTMLButtonElement;
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  const party = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (choice) => choice.getAttribute("aria-label") === "React with 🎉",
  ) as HTMLElement;
  await act(() => party.focus());
  await key(party, "Enter");
  await nextFrame();
  expect(react).toHaveBeenCalledWith(ROOM, base.id, "🎉");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  const chip = view.host.querySelector(".chat-reaction") as HTMLButtonElement;
  await act(() => chip.focus());
  await click(chip);
  expect(react).toHaveBeenLastCalledWith(ROOM, base.id, "👍");
  await view.render(tree([]));
  expect(view.host.querySelector(".chat-reactions")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("never moves focus on later refreshes when the reacted chip survives", async () => {
  const pod = createDemoPod({ root: ROOT });
  vi.spyOn(ChatClient.prototype, "react").mockResolvedValue();
  const active = session(pod);
  const base = message("survivor");
  const tree = (reactions: Message["reactions"]) =>
    h(ChatProvider, {
      session: active,
      children: h(Timeline, { ...timelineProps, messages: [{ ...base, reactions }] }),
    });
  const view = await mount(tree([{ emoji: "👍", count: 2, reactedByMe: false }]));
  const chip = view.host.querySelector(".chat-reaction") as HTMLButtonElement;
  await act(() => chip.focus());
  await click(chip);
  // The write's refresh keeps the chip: the focus request is used up.
  await view.render(tree([{ emoji: "👍", count: 3, reactedByMe: true }]));
  await act(() => chip.blur());
  expect(document.activeElement).toBe(document.body);
  // A later poll refresh must not pull focus into this message.
  await view.render(tree([{ emoji: "👍", count: 4, reactedByMe: true }]));
  expect(document.activeElement).toBe(document.body);
});
it("collapses a flood of distinct reactions, keeping the reader's own visible", async () => {
  const pod = createDemoPod({ root: ROOT });
  const reactions = Array.from({ length: 30 }, (_, index) => ({
    emoji: String.fromCodePoint(0x1f600 + index),
    count: 1,
    reactedByMe: index === 29,
  }));
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, {
        ...timelineProps,
        messages: [{ ...message("flood"), reactions }],
      }),
    }),
  );
  const chips = [...view.host.querySelectorAll(".chat-reaction")];
  expect(chips).toHaveLength(20);
  expect(chips.at(-1)?.getAttribute("aria-pressed")).toBe("true");
  expect(view.host.querySelector(".chat-reaction-more")?.textContent).toBe("+10 more");
});
it("hides reaction controls on deleted and pending messages", async () => {
  const pod = createDemoPod({ root: ROOT });
  const item = {
    ...message("deleted"),
    deleted: true,
    reactions: [{ emoji: "👍", count: 1, reactedByMe: true }],
  };
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, { ...timelineProps, messages: [item] }),
    }),
  );
  expect(view.host.querySelector(".chat-reactions")).toBeNull();
  expect(view.host.querySelector('[aria-label="Add reaction"]')).toBeNull();
  await view.render(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, {
        ...timelineProps,
        messages: [],
        outgoing: [
          {
            ...item,
            deleted: false,
            localId: "pending",
            at: new Date(),
            room: ROOM,
            draft: "Pending",
            status: "sending",
          },
        ],
      }),
    }),
  );
  expect(view.host.querySelector(".chat-reactions")).toBeNull();
  expect(view.host.querySelector('[aria-label="Add reaction"]')).toBeNull();
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

it.each([
  true,
  false,
])("offers a Copy link fallback only for failed members within this pod: %s", async (samePod) => {
  const { toast } = await import("@jeswr/suite-ui");
  const pod = createDemoPod({ root: ROOT });
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal("location", new URL("https://suite.example/"));
  try {
    await mount(h(ChatProvider, { session: session(pod), children: h(NewRoomPage) }));
    await fill(
      document.querySelector('input[placeholder="e.g. Book club"]') as HTMLInputElement,
      "Invited room",
    );
    await fill(
      document.querySelector('[role="combobox"]') as HTMLInputElement,
      samePod ? `${ROOT}bob/profile#me` : "https://bob.example.org/profile/card#me",
    );
    await click(document.querySelector(".su-picker-input button") as HTMLElement);
    await click(document.querySelector('button[type="submit"]') as HTMLElement);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Invite people");
    const notice = toast.getHistory().at(-1);
    if (!notice || !("title" in notice)) throw new Error("Missing delivery notice");
    const title = typeof notice.title === "function" ? notice.title() : notice.title;
    expect(renderToStaticMarkup(h("div", null, title))).toContain(
      samePod ? "notify 1 member. Share the invite link instead." : "notify 1 member.",
    );
    if (!samePod) {
      expect(notice.action).toBeUndefined();
      expect(renderToStaticMarkup(h("div", null, title))).not.toContain("Share the invite link");
      return;
    }
    const action = notice?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("Missing toast action");
    expect(action.label).toBe("Copy link");
    await act(() =>
      action.onClick({ defaultPrevented: false } as Parameters<typeof action.onClick>[0]),
    );
    expect(writeText).toHaveBeenCalledWith(
      `https://suite.example/chat/r/${encodeRef(`${ROOT}chat/rooms/invited-room/`)}`,
    );
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(globalThis, "location");
  }
});

it("lets room creation and failure notices finish after unmount, and fences late navigation", async () => {
  const pod = createDemoPod({ root: ROOT });
  const pending = deferred<Awaited<ReturnType<ChatClient["createRoom"]>>>();
  const create = vi.spyOn(ChatClient.prototype, "createRoom").mockReturnValue(pending.promise);
  const view = await mount(h(ChatProvider, { session: session(pod), children: h(NewRoomPage) }));
  await fill(
    document.querySelector('input[placeholder="e.g. Book club"]') as HTMLInputElement,
    "Late room",
  );
  await click(document.querySelector('button[type="submit"]') as HTMLElement);
  const signal = create.mock.calls[0]?.[0].signal;
  expect(signal?.aborted).toBe(false);
  await view.unmount();
  expect(signal?.aborted).toBe(false);
  await act(() =>
    pending.resolve({
      url: ROOM,
      name: "Late room",
      members: [ME],
      creator: ME,
      created: undefined,
      isDirect: false,
      invitations: [{ webId: "https://foreign.example/#me", delivered: false }],
    }),
  );
  const { toast } = await import("@jeswr/suite-ui");
  const notice = toast.getHistory().at(-1);
  if (!notice || !("title" in notice)) throw new Error("Missing detached delivery notice");
  const title = typeof notice.title === "function" ? notice.title() : notice.title;
  expect(renderToStaticMarkup(h("div", null, title))).toContain("notify 1 member.");
  expect(routing.replace).not.toHaveBeenCalled();
});

it("opens an existing room outside chat/rooms/<slug>/ in the user's pod", async () => {
  const pod = createDemoPod({ root: ROOT });
  const url = `${ROOT}notes/long-chat/`;
  const room = vi.spyOn(ChatClient.prototype, "room").mockResolvedValue({
    url,
    name: "Long chat",
    members: [ME],
    creator: ME,
    created: undefined,
    isDirect: false,
  });
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomRoute, { reference: encodeRef(url) }),
    }),
  );
  expect(view.host.textContent).not.toContain("This room link isn't valid");
  expect(view.host.querySelector("h1")?.textContent).toBe("Long chat");
  expect(room).toHaveBeenCalledWith(url);
  await view.render(
    h(ChatProvider, {
      session: session(pod),
      children: h(RoomRoute, { reference: encodeRef(`${url}?q=1`) }),
    }),
  );
  expect(view.host.textContent).toContain("This room link isn't valid");
});

it("tells a non-member why Join is unavailable", async () => {
  const pod = createDemoPod({ root: ROOT });
  const owner = new ChatClient(pod.fetch, ROOT, "https://bob.example/#me");
  const room = await owner.createRoom({ name: "Members only", members: [] });
  // The demo pod's storage is shared, so leave the owner's joined list to view as a stranger.
  await owner.leave(room.url);
  const view = await mount(
    h(ChatProvider, { session: session(pod), children: h(RoomView, { url: room.url }) }),
  );
  const prompt = view.host.querySelector(".chat-join") as HTMLElement;
  expect(prompt.textContent).toContain(
    "You can't join because this account is not a member of this room. Ask the room creator to add you.",
  );
  expect(prompt.textContent).not.toContain("Join this conversation");
  expect(prompt.querySelector("button")?.disabled).toBe(true);
});

it.each([
  [true, 1],
  [false, 0],
])("shows a creation's delivery notice only while the same account is active (%s)", async (same, notices) => {
  const pod = createDemoPod({ root: ROOT });
  const pending = deferred<Awaited<ReturnType<ChatClient["createRoom"]>>>();
  vi.spyOn(ChatClient.prototype, "createRoom").mockReturnValue(pending.promise);
  let active = true;
  const isActiveAccount = vi.fn(() => active);
  const accounts = {
    active: { id: "alice" },
    sessionVersion: 7,
    isActiveAccount,
  } as unknown as AccountsContextValue;
  const view = await mount(
    h(
      AccountsContext,
      { value: accounts },
      h(ChatProvider, { session: session(pod), children: h(NewRoomPage) }),
    ),
  );
  await fill(
    document.querySelector('input[placeholder="e.g. Book club"]') as HTMLInputElement,
    "Switched room",
  );
  await click(document.querySelector('button[type="submit"]') as HTMLElement);
  await view.unmount();
  active = same;
  const { toast } = await import("@jeswr/suite-ui");
  const before = toast.getHistory().length;
  await act(() =>
    pending.resolve({
      url: ROOM,
      name: "Switched room",
      members: [ME],
      creator: ME,
      created: undefined,
      isDirect: false,
      invitations: [{ webId: "https://foreign.example/#me", delivered: false }],
    }),
  );
  expect(toast.getHistory().length - before).toBe(notices);
  expect(isActiveAccount).toHaveBeenCalledWith("alice", 7);
});
