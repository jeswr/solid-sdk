// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient, type Room } from "../src/apps/chat/lib/client";
import {
  ChatProvider,
  type ChatSession,
  useChat,
  useMessages,
  useRoom,
  useRooms,
  useSend,
} from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, deferred, h, mount } from "./drive-ui-dom";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function session(pod: ReturnType<typeof createDemoPod>, subscribe = true): ChatSession {
  return {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: ROOT,
    webId: ME,
    displayName: "Alice",
    reset: async () => {},
    ...(subscribe ? { subscribe: pod.subscribe } : {}),
  };
}
it("loads rooms, pages backwards while retaining the current snapshot, and merges live edits", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "History", members: [] });
  const now = new Date();
  await client.send(room.url, "Recent", { at: now });
  const old = new Date(now.getTime() - 9 * 86400000);
  await client.send(room.url, "History", { at: old });
  let state!: ReturnType<typeof useMessages>;
  let joined!: ReturnType<typeof useRooms>;
  let chat!: ReturnType<typeof useChat>;
  function Probe() {
    state = useMessages(room.url);
    joined = useRooms();
    chat = useChat();
    return h("p", null, state.data?.messages.map((m) => m.content).join(","));
  }
  const view = await mount(h(ChatProvider, { session: session(pod), children: h(Probe) }));
  expect(joined.status).toBe("ready");
  expect(view.host.textContent).toBe("Recent");
  await act(() => state.loadOlder());
  expect(view.host.textContent).toBe("History,Recent");
  await act(async () => {
    const incoming = await client.send(room.url, "Live");
    await client.edit(room.url, incoming.id, "Live edited");
    chat.invalidate();
  });
  expect(view.host.textContent).toBe("History,Recent,Live edited");
});
it("uses the filtered change channel and polls every 30 seconds when subscribe is missing", async () => {
  const pod = createDemoPod({ root: ROOT });
  let listener: (url: string) => void = () => {};
  const unsubscribe = vi.fn();
  const withChannel = {
    ...session(pod),
    subscribe: (changed: (url: string) => void) => {
      listener = changed;
      return unsubscribe;
    },
  };
  const list = vi.spyOn(ChatClient.prototype, "joinedRooms");
  function Probe() {
    const rooms = useRooms();
    return h("p", null, rooms.status);
  }
  const view = await mount(h(ChatProvider, { session: withChannel, children: h(Probe) }));
  vi.useFakeTimers();
  const calls = list.mock.calls.length;
  await act(async () => {
    listener(`${ROOT}drive/file.txt`);
    await vi.advanceTimersByTimeAsync(30);
  });
  expect(list).toHaveBeenCalledTimes(calls);
  await act(async () => {
    listener(`${ROOT}chat/rooms.ttl`);
    await vi.advanceTimersByTimeAsync(30);
  });
  expect(list).toHaveBeenCalledTimes(calls + 1);
  await view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
  const poll = await mount(h(ChatProvider, { session: session(pod, false), children: h(Probe) }));
  const before = list.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(29_999));
  expect(list).toHaveBeenCalledTimes(before);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(list).toHaveBeenCalledTimes(before + 1);
  await poll.unmount();
});
it("queues offline hook sends and flushes them on online", async () => {
  const pod = createDemoPod({ root: ROOT });
  const client = new ChatClient(pod.fetch, ROOT, ME);
  const room = await client.createRoom({ name: "Offline", members: [] });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  let sender!: ReturnType<typeof useSend>;
  function Probe() {
    sender = useSend(room.url);
    return h("p", null, sender.data.map((m) => m.status ?? "sent").join(","));
  }
  const view = await mount(h(ChatProvider, { session: session(pod), children: h(Probe) }));
  await act(() => sender.send("Queued"));
  expect(view.host.textContent).toBe("sending");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(() => window.dispatchEvent(new Event("online")));
  expect(view.host.textContent).toBe("sent");
  expect((await client.messages(room.url)).messages[0]?.content).toBe("Queued");
});
it("clears prior-room data on navigation and ignores late abandoned responses", async () => {
  const pod = createDemoPod({ root: ROOT });
  const a = deferred<Room>();
  const b = deferred<Room>();
  const roomA = `${ROOT}chat/rooms/a/`;
  const roomB = `${ROOT}chat/rooms/b/`;
  vi.spyOn(ChatClient.prototype, "room").mockImplementation((url) =>
    url === roomA ? a.promise : b.promise,
  );
  let current!: ReturnType<typeof useRoom>;
  function Probe({ url }: { url: string }) {
    current = useRoom(url);
    return h("p", null, current.data?.name ?? current.status);
  }
  const activeSession = session(pod);
  const view = await mount(
    h(ChatProvider, { session: activeSession, children: h(Probe, { url: roomA }) }),
  );
  await view.render(
    h(ChatProvider, { session: activeSession, children: h(Probe, { url: roomB }) }),
  );
  await act(() =>
    a.resolve({
      url: roomA,
      name: "Abandoned",
      members: [],
      isDirect: false,
      creator: undefined,
      created: undefined,
    }),
  );
  expect(view.host.textContent).toBe("loading");
  await act(() => b.reject(new Error("unavailable")));
  expect(current.status).toBe("error");
  expect(current.data).toBeUndefined();
  const replacement = {
    url: roomB,
    name: "Retried",
    members: [],
    isDirect: false,
    creator: undefined,
    created: undefined,
  };
  vi.spyOn(ChatClient.prototype, "room").mockResolvedValue(replacement);
  await act(() => current.retry());
  expect(view.host.textContent).toBe("Retried");
});
