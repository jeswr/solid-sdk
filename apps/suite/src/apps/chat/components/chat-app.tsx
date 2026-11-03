// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  renderAsync,
  Toaster,
} from "@jeswr/suite-ui";
import { MessageSquare, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { characterShortcutsEnabled } from "@/shell/lib/shortcut-settings";
import { classifyChatError, type Room } from "../lib/client";
import {
  ChatProvider,
  useAsync,
  useChat,
  useReadPreferences,
  useRooms,
  useUnread,
} from "../state/chat-context";
import { ChatSearchField } from "./search-field";

export function ChatFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState
      error={classifyChatError(error)}
      actions={{
        retry,
        reload: retry,
        home: "/chat",
        resolveConflict: retry,
        signIn: retry,
        switchAccount: "/chat",
      }}
    />
  );
}
export function useProfile(webId: string) {
  const { client, session } = useChat();
  const [name, setName] = useState("");
  useEffect(() => {
    let active = true;
    setName("");
    if (webId === session.webId) setName(session.displayName);
    else if (webId) void client.profile(webId).then((value) => active && setName(value));
    return () => {
      active = false;
    };
  }, [client, session, webId]);
  return { displayName: name, loading: !name && !!webId };
}
export function PersonName({ webId }: { webId: string }) {
  const { displayName } = useProfile(webId);
  return <>{displayName || webId || "Unknown author"}</>;
}
export function RoomName({ room }: { room: Room }) {
  const { session } = useChat();
  return room.isDirect ? (
    <PersonName webId={room.members.find((id) => id !== session.webId) ?? session.webId} />
  ) : (
    room.name || "Untitled room"
  );
}
function SidebarRow({ room, count }: { room: Room; count: number }) {
  const path = `/chat/r/${encodeRef(room.url)}`;
  const pathname = usePathname();
  return (
    <li>
      <Link
        href={path}
        aria-current={pathname === path ? "page" : undefined}
        className="chat-room-link"
      >
        <span className="chat-avatar" aria-hidden="true">
          {room.isDirect ? "@" : room.name.slice(0, 1).toUpperCase() || "#"}
        </span>
        <span className="chat-room-label">
          <RoomName room={room} />
        </span>
        {count > 0 && <CountBadge count={count} />}
      </Link>
    </li>
  );
}
export function ChatEmpty() {
  return (
    <div className="chat-state">
      <h1>Chat</h1>
      <h2 className="sr-only">Conversations</h2>
      <EmptyState
        title="No conversations yet"
        body="Make a little space for a conversation. Your messages live in your pod."
        icon={<MessageSquare aria-hidden="true" />}
        primaryAction={
          <Button asChild>
            <Link href="/chat/new">Start a room</Link>
          </Button>
        }
      />
    </div>
  );
}
function Sidebar() {
  const rooms = useRooms();
  const unread = useUnread();
  return (
    <nav className="chat-sidebar" aria-label="Conversations">
      <ChatSearchField />
      <Button asChild className="chat-new-room">
        <Link href="/chat/new">
          <Plus aria-hidden="true" size={18} />
          New room
        </Link>
      </Button>
      {renderAsync({
        loading: !rooms.data && rooms.status === "loading" && (
          <LoadingSkeleton preset="list" count={3} />
        ),
        error: rooms.status === "error" && <ChatFailure error={rooms.error} retry={rooms.retry} />,
        children: (
          <>
            {[false, true].map((direct) => (
              <section key={String(direct)}>
                <h2>{direct ? "Direct messages" : "Rooms"}</h2>
                <ul>
                  {rooms.data?.map((room) =>
                    "error" in room
                      ? !direct && (
                          <li key={room.url} className="chat-broken-room">
                            <Link href={`/chat/r/${encodeRef(room.url)}`}>Unavailable room</Link>
                          </li>
                        )
                      : room.isDirect === direct && (
                          <SidebarRow
                            key={room.url}
                            room={room}
                            count={unread.data?.[room.url] ?? 0}
                          />
                        ),
                  )}
                </ul>
                {rooms.data?.length === 0 && (
                  <p className="chat-hint">
                    {direct ? "Start a direct message with someone." : "Create a room to begin."}
                  </p>
                )}
              </section>
            ))}
          </>
        ),
      })}
      {unread.status === "error" && rooms.data && rooms.data.length > 0 && (
        <p className="chat-hint">
          Unread counts unavailable.{" "}
          <Button variant="ghost" size="sm" onClick={unread.retry}>
            Retry unread counts
          </Button>
        </p>
      )}
    </nav>
  );
}
function Details({ url }: { url: string }) {
  const { client, setDetails } = useChat();
  const room = useAsync(useCallback(() => client.room(url), [client, url]));
  const files = useAsync(useCallback(() => client.files(url), [client, url]));
  return (
    <div className="chat-details">
      <div className="chat-details-heading">
        <h2>Conversation details</h2>
        <IconButton label="Close details" variant="ghost" onClick={() => setDetails(false)}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <h3>Members</h3>
      {room.status === "error" ? (
        <ChatFailure error={room.error} retry={room.retry} />
      ) : (
        <ul>
          {room.data?.members.map((webId) => (
            <li key={webId}>
              <strong>
                <PersonName webId={webId} />
              </strong>
              <a href={webId} target="_blank" rel="noopener noreferrer nofollow">
                {webId}
              </a>
            </li>
          ))}
        </ul>
      )}
      <h3>Files</h3>
      {files.status === "error" ? (
        <ChatFailure error={files.error} retry={files.retry} />
      ) : files.status === "loading" && !files.data ? (
        <LoadingSkeleton preset="list" count={2} />
      ) : files.data?.length ? (
        <ul>
          {files.data.map((file) => (
            <li key={file}>
              <Link href={`/drive/p/${encodeRef(file)}`}>
                {new URL(file).pathname.split("/").at(-1) || "File"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No files in this room.</p>
      )}
    </div>
  );
}
function Chrome({ children }: { children: ReactNode }) {
  const { details, setDetails, currentRoom } = useChat();
  const router = useRouter();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
          )) ||
        !characterShortcutsEnabled()
      )
        return;
      if (event.key === "/") {
        if (
          event.target instanceof Element &&
          event.target.closest(
            '[role="alertdialog"],[role="menu"],[role="listbox"],[role="dialog"]:not(.ish-drawer)',
          )
        )
          return;
        const field =
          document.querySelector<HTMLInputElement>(
            '[role="dialog"].ish-drawer [data-chat-search]',
          ) ?? document.querySelector<HTMLInputElement>('[data-chat-search="page"]');
        if (field) {
          field.focus();
          event.preventDefault();
        } else if (window.matchMedia("(max-width: 1023px)").matches) {
          router.push("/chat/search");
          event.preventDefault();
        } else {
          const sidebar = document.querySelector<HTMLInputElement>(
            ".ish-sidebar [data-chat-search]",
          );
          if (sidebar) {
            sidebar.focus();
            event.preventDefault();
          }
        }
      }
      if (event.key === "]") {
        event.preventDefault();
        setDetails(!details);
      }
    };
    addEventListener("keydown", shortcut);
    return () => removeEventListener("keydown", shortcut);
  }, [details, setDetails, router]);
  return (
    <SuiteFrame
      app="chat"
      context={<span className="chat-app-title">Chat</span>}
      sidebar={<Sidebar />}
      details={details && currentRoom ? <Details url={currentRoom} /> : undefined}
      onDetailsClose={() => setDetails(false)}
    >
      {children}
    </SuiteFrame>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="chat-state" role="status">
        Opening your Chat…
      </div>
    );
  if (state.status === "error")
    return (
      <div className="chat-state" role="alert">
        <h1>Can't open your Chat</h1>
        <p>
          {state.mode === "extension"
            ? "This browser couldn't open your pod through the Solid extension."
            : "This browser couldn't open the demo pod's storage."}
        </p>
        <Button onClick={() => location.reload()}>Retry</Button>
      </div>
    );
  return (
    <ChatProvider
      key={JSON.stringify([state.session.mode, state.session.webId, state.session.storageUrl])}
      session={state.session}
    >
      <Chrome>{children}</Chrome>
    </ChatProvider>
  );
}
export function ChatApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
export function ChatLanding() {
  const rooms = useRooms();
  const preferences = useReadPreferences();
  const router = useRouter();
  const ready = rooms.status === "ready" && preferences.status === "ready";
  const joined = rooms.data ?? [];
  const mostRecent = [...(preferences.data ?? [])]
    .filter((marker) => joined.some((room) => room.url === marker.roomId))
    .sort((a, b) => (b.lastRead ?? -Infinity) - (a.lastRead ?? -Infinity))[0]?.roomId;
  const target = mostRecent ?? joined[0]?.url;
  useEffect(() => {
    if (ready && target) router.replace(`/chat/r/${encodeRef(target)}`);
  }, [router, ready, target]);
  if (rooms.status === "error") return <ChatFailure error={rooms.error} retry={rooms.retry} />;
  if (preferences.status === "error")
    return <ChatFailure error={preferences.error} retry={preferences.retry} />;
  return ready && !target ? (
    <ChatEmpty />
  ) : (
    <LoadingSkeleton preset="list" label="Loading conversations" />
  );
}
