// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { notifySavedText } from "@jeswr/suite-sdk/chips";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ChatClient, classifyChatError, type JoinedRoom, type Message } from "../lib/client";
import type { ReadPreferences } from "../lib/model";
import { ChatLocalState } from "./local-state";
import { ChatOutbox, type Outgoing } from "./outbox";

export type { Outgoing } from "./outbox";

/** A pod session whose change feed may be absent (the polling path); distributes over session modes. */
export type ChatSession = PodSession extends infer S
  ? S extends PodSession
    ? Omit<S, "subscribe"> & { subscribe?: PodSession["subscribe"] }
    : never
  : never;
/** Extension sessions provide a credential-free fetch for other people's public profiles. */
function publicFetchOf(session: ChatSession): typeof globalThis.fetch {
  return session.mode === "extension" ? session.publicFetch : globalThis.fetch;
}
export interface AsyncResult<T> {
  status: "loading" | "ready" | "error";
  data: T | undefined;
  error: unknown;
  retry: () => void;
}
interface ChatContextValue {
  client: ChatClient;
  local: ChatLocalState;
  session: ChatSession;
  revision: number;
  invalidate: () => void;
  trackRooms: (rooms: JoinedRoom[]) => void;
  outbox: Outgoing[];
  send: (room: string, text: string) => void;
  retrySend: (id: string) => void;
  discard: (id: string) => void;
  acknowledge: (ids: ReadonlySet<string>) => void;
  details: boolean;
  setDetails: (open: boolean) => void;
  currentRoom: string | undefined;
  setCurrentRoom: (url: string | undefined) => void;
}
const Context = createContext<ChatContextValue | null>(null);
export function ChatProvider({ session, children }: { session: ChatSession; children: ReactNode }) {
  const publicFetch = publicFetchOf(session);
  const client = useMemo(
    () =>
      new ChatClient(
        session.fetch,
        session.storageUrl,
        session.webId,
        publicFetch,
        session.displayName,
      ),
    [session.fetch, session.storageUrl, session.webId, publicFetch, session.displayName],
  );
  const [revision, setRevision] = useState(0);
  const local = useMemo(() => new ChatLocalState(session.webId), [session.webId]);
  const notifySaved = useRef<(message: Message) => void>(() => {});
  useLayoutEffect(() => {
    notifySaved.current = (message) => {
      void notifySavedText(session, message.id, "", message.content, "Chat message").catch(
        () => {},
      );
    };
    return () => {
      notifySaved.current = () => {};
    };
  }, [session]);
  const queue = useMemo(
    () =>
      new ChatOutbox(
        client,
        () => navigator.onLine !== false,
        local,
        (message) => {
          notifySaved.current(message);
        },
      ),
    [client, local],
  );
  const outbox = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  const rooms = useRef<string[]>([]);
  const [details, setDetails] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string>();
  const invalidate = useCallback(() => setRevision((value) => value + 1), []);
  const trackRooms = useCallback((joined: JoinedRoom[]) => {
    rooms.current = joined.map((room) => room.url);
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const changed = (url: string) => {
      if (
        url === session.storageUrl ||
        url.startsWith(`${session.storageUrl}chat/`) ||
        url === `${session.storageUrl}settings/chat-preferences.json` ||
        rooms.current.some((room) => url.startsWith(room))
      ) {
        clearTimeout(timer);
        timer = setTimeout(invalidate, 30);
      }
    };
    const unsubscribe = session.subscribe?.(changed);
    const poll = session.subscribe ? undefined : setInterval(invalidate, 30_000);
    return () => {
      unsubscribe?.();
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [session, invalidate]);
  useEffect(() => {
    const online = () => {
      queue.flush();
      invalidate();
    };
    addEventListener("online", online);
    queue.flush();
    return () => removeEventListener("online", online);
  }, [queue, invalidate]);
  const send = queue.send;
  const retrySend = queue.retry;
  const discard = queue.discard;
  const acknowledge = queue.acknowledge;
  const value = useMemo(
    () => ({
      client,
      local,
      session,
      revision,
      invalidate,
      trackRooms,
      outbox,
      send,
      retrySend,
      discard,
      acknowledge,
      details,
      setDetails,
      currentRoom,
      setCurrentRoom,
    }),
    [
      client,
      local,
      session,
      revision,
      invalidate,
      trackRooms,
      outbox,
      send,
      retrySend,
      discard,
      acknowledge,
      details,
      currentRoom,
    ],
  );
  return <Context value={value}>{children}</Context>;
}
export function useChat() {
  const value = useContext(Context);
  if (!value) throw new Error("ChatProvider is required");
  return value;
}

export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  refresh = true,
  resource: unknown = load,
): AsyncResult<T> {
  const { revision } = useChat();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<AsyncResult<T>, "retry"> & { resource: unknown }>({
    resource,
    status: "loading",
    data: undefined,
    error: undefined,
  });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const key = refresh ? revision : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key and attempt invalidate the current read
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setState((current) => ({
      resource,
      status: "loading",
      data: current.resource === resource ? current.data : undefined,
      error: undefined,
    }));
    void load(controller.signal).then(
      (data) => live && setState({ resource, status: "ready", data, error: undefined }),
      (error: unknown) =>
        live &&
        setState((current) => ({
          resource,
          status: "error",
          data:
            current.resource === resource && classifyChatError(error) === "unreachable"
              ? current.data
              : undefined,
          error,
        })),
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [load, key, attempt, resource]);
  return state.resource === resource
    ? { status: state.status, data: state.data, error: state.error, retry }
    : { status: "loading", data: undefined, error: undefined, retry };
}
export function useRooms() {
  const { client, trackRooms } = useChat();
  const load = useCallback(() => client.joinedRooms(), [client]);
  const result = useAsync(load);
  useEffect(() => {
    if (result.data) trackRooms(result.data);
  }, [result.data, trackRooms]);
  return result;
}
export function useRoom(url: string) {
  const { client } = useChat();
  return useAsync(useCallback(() => client.room(url), [client, url]));
}
export function useMessages(url: string, since?: string) {
  const { client, acknowledge } = useChat();
  const resource = useMemo(() => ({ client, url }), [client, url]);
  const [paging, setPaging] = useState({ url, pages: 1 });
  const pages = paging.url === url ? paging.pages : 1;
  const result = useAsync(
    useCallback(async () => {
      let before = new Date();
      const all: Message[] = [];
      let next: Date | null = null;
      for (let page = 0; page < pages; page++) {
        const result = await client.messages(url, {
          before,
          ...(since ? { since: new Date(since) } : {}),
        });
        all.push(...result.messages);
        next = result.next;
        if (!next) break;
        before = next;
      }
      const messages = [...new Map(all.map((message) => [message.id, message])).values()].sort(
        (a, b) => (a.published ?? "").localeCompare(b.published ?? "") || a.id.localeCompare(b.id),
      );
      return { messages, next };
    }, [client, url, pages, since]),
    true,
    resource,
  );
  useEffect(() => {
    if (result.data) acknowledge(new Set(result.data.messages.map((message) => message.id)));
  }, [result.data, acknowledge]);
  const loadOlder = useCallback(() => setPaging({ url, pages: pages + 1 }), [url, pages]);
  return { ...result, loadOlder };
}
export function useDraft(url: string) {
  const { local } = useChat();
  const draft = useSyncExternalStore(
    local.subscribe,
    () => local.draft(url),
    () => "",
  );
  return [draft, (text: string) => local.setDraft(url, text)] as const;
}
export function useSend(url: string) {
  const chat = useChat();
  return {
    status: "ready" as const,
    data: chat.outbox.filter((item) => item.room === url),
    error: undefined,
    retry: chat.retrySend,
    discard: chat.discard,
    send: (text: string) => chat.send(url, text),
  };
}
export function useUnread() {
  const { client } = useChat();
  const rooms = useRooms();
  const urls = (rooms.data ?? [])
    .filter((room) => !("error" in room))
    .map((room) => room.url)
    .join("\n");
  const load = useCallback(
    () => client.unreadCounts(urls ? urls.split("\n").map((url) => ({ url })) : []),
    [client, urls],
  );
  return useAsync(load);
}
export function useReadPreferences() {
  const { client } = useChat();
  return useAsync(
    useCallback(
      async (): Promise<ReadPreferences> => (await client.preferences.read()).data,
      [client],
    ),
  );
}
export function useChatActions() {
  const { client, invalidate } = useChat();
  return useMemo(
    () => ({
      status: "ready" as const,
      data: client,
      error: undefined,
      retry: invalidate,
      async join(url: string) {
        await client.join(url);
        invalidate();
      },
      async leave(url: string) {
        await client.leave(url);
        invalidate();
      },
      async edit(url: string, subject: string, text: string) {
        await client.edit(url, subject, text);
        invalidate();
      },
      async remove(url: string, subject: string) {
        await client.remove(url, subject);
        invalidate();
      },
      async react(url: string, subject: string, emoji: string) {
        await client.react(url, subject, emoji);
        invalidate();
      },
      async toTask(url: string, subject: string, task: { title: string; due?: Date }) {
        await client.toTask(url, subject, task);
        invalidate();
      },
      async markRead(url: string, at: Date) {
        await client.preferences.markRead(url, at);
        invalidate();
      },
    }),
    [client, invalidate],
  );
}
