// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient, type Message } from "../src/apps/chat/lib/client";
import { ChatProvider, type ChatSession } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { Composer } from "../src/apps/chat/components/composer";
import { MessageText } from "../src/apps/chat/components/message-text";
import { NewRoomPage } from "../src/apps/chat/components/new-room";
import { RoomView } from "../src/apps/chat/components/room";
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
  const messages = Array.from({ length: 240 }, (_, i) =>
    message(`message-${String(i).padStart(3, "0")}`, ME, new Date(Date.now() + i * 1000)),
  );
  const view = await mount(
    h(ChatProvider, {
      session: session(pod),
      children: h(Timeline, { ...timelineProps, messages }),
    }),
  );
  expect(view.host.querySelectorAll("article")).toHaveLength(200);
  const log = view.host.querySelector('[role="log"]') as HTMLElement;
  await key(log, "Home");
  await nextFrame();
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[0]?.id);
  await key(document.activeElement as HTMLElement, "End");
  await nextFrame();
  expect((document.activeElement as HTMLElement).dataset.messageId).toBe(messages[239]?.id);
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
