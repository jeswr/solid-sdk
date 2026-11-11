// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, withOutbox } from "@jeswr/suite-sdk/offline";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatProvider, type ChatSession, useChat } from "../src/apps/chat/state/chat-context";
import type { useOutboxSession } from "../src/shell/sync/outbox-session";
import { act, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({ session: null as ReturnType<typeof useOutboxSession> }));
vi.mock("@/shell/sync/outbox-session", () => ({ useOutboxSession: () => mocks.session }));
const root = "https://pod.example/";
const webId = `${root}profile#me`;
const boxes: ReturnType<typeof createOutbox>[] = [];
function fixture(identity = webId) {
  const outbox = createOutbox({ webId: identity });
  boxes.push(outbox);
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const registerGuardPolicy = vi.fn(outbox.registerGuardPolicy);
  const registerReplayDelegate = vi.fn<
    NonNullable<ReturnType<typeof useOutboxSession>>["registerReplayDelegate"]
  >((tag, factory) => {
    if (!mocks.session?.storage) throw new Error("Storage opening");
    return outbox.registerDelegate(
      tag,
      factory({ storage, fetch, webId: identity, signal: controller.signal, storageUrl: root }),
    );
  });
  const session = {
    account: { webId: identity },
    outbox,
    adapter: { reconnected: vi.fn().mockResolvedValue(undefined) },
    storage: null,
    signal: controller.signal,
    registerGuardPolicy,
    registerReplayDelegate,
  } as unknown as NonNullable<ReturnType<typeof useOutboxSession>>;
  const chat: ChatSession = {
    mode: "solid",
    fetch,
    publicFetch: fetch,
    webId: identity,
    storageUrl: root,
    displayName: "Alice",
    subscribe: () => () => {},
  };
  return {
    outbox,
    storage,
    controller,
    session,
    chat,
    registerGuardPolicy,
    registerReplayDelegate,
  };
}
function Probe() {
  const chat = useChat();
  return h("div", null, chat.outbox.map((item) => item.content).join());
}
const tree = (session: ChatSession) =>
  h(StrictMode, null, h(ChatProvider, { session, children: h(Probe) }));
afterEach(() => {
  mocks.session = null;
  for (const box of boxes.splice(0)) box.close();
});

it("registers after storage opens even on the same session object, cleans up and re-registers under StrictMode", async () => {
  const f = fixture();
  mocks.session = f.session;
  const view = await mount(tree(f.chat));
  expect(f.registerReplayDelegate).not.toHaveBeenCalled();
  f.session.storage = withOutbox(f.storage, f.outbox);
  await view.render(tree(f.chat));
  expect(f.registerReplayDelegate).toHaveBeenCalledOnce();
  expect(f.registerGuardPolicy).toHaveBeenCalledOnce();
  expect(f.session.adapter.reconnected).toHaveBeenCalledOnce();
  await act(() =>
    f.outbox.enqueue({
      op: "write",
      url: `${root}chat/rooms/a/2026/11/11.ttl`,
      contentType: "application/json",
      body: JSON.stringify({
        room: `${root}chat/rooms/a/`,
        at: "2026-11-11T00:00:00.000Z",
        id: "stable",
        content: "Pending",
      }),
      guard: { tag: "chat.message-v1" },
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.host.textContent).toBe("Pending");
  await view.unmount();
  expect(f.outbox.pending()[0]?.blocked).toBe("no-delegate");
  await mount(tree(f.chat));
  expect(f.outbox.pending()[0]?.blocked).toBeUndefined();
});

it("does not register a foreign session or paint a previous identity's pending message", async () => {
  const first = fixture();
  first.session.storage = withOutbox(first.storage, first.outbox);
  mocks.session = first.session;
  const view = await mount(tree(first.chat));
  const next = fixture(`${root}bob#me`);
  next.session.storage = withOutbox(next.storage, next.outbox);
  await view.render(tree(next.chat));
  expect(next.registerReplayDelegate).not.toHaveBeenCalled();
  mocks.session = next.session;
  await view.render(tree(next.chat));
  expect(next.registerReplayDelegate).toHaveBeenCalledOnce();
  expect(view.host.textContent).toBe("");
});
