// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  LoadingSkeleton,
  toast,
} from "@jeswr/suite-ui";
import { Copy, Info, MessageSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { decodeIdentifierRef, decodeRef } from "@/lib/refs";
import { usePageRouteParams } from "@/lib/route-params";
import type { Message } from "../lib/client";
import { invitationRoom } from "../lib/model";
import {
  useChat,
  useChatActions,
  useMessages,
  useRoom,
  useRooms,
  useSend,
} from "../state/chat-context";
import { ChatFailure, RoomName, useProfile } from "./chat-app";
import { Composer } from "./composer";
import { Timeline } from "./timeline";

function TaskDialog({
  message,
  url,
  onClose,
}: {
  message: Message;
  url: string;
  onClose: () => void;
}) {
  const actions = useChatActions();
  const [title, setTitle] = useState(message.content);
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="chat-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const article = [...document.querySelectorAll<HTMLElement>("[data-message-id]")].find(
            (node) => node.dataset.messageId === message.id,
          );
          (
            article?.querySelector<HTMLButtonElement>('[aria-label="Message actions"]') ?? article
          )?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Turn into task</DialogTitle>
          <DialogDescription>
            Give this message a task title and an optional due date.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            void actions
              .toTask(url, message.id, {
                title: title.trim(),
                ...(due ? { due: new Date(`${due}T12:00:00Z`) } : {}),
              })
              .then(
                () => {
                  toast.success("Task created");
                  onClose();
                },
                () => setError("Couldn't create the task. Try again."),
              )
              .finally(() => setSaving(false));
          }}
        >
          <Label htmlFor={`${id}-title`}>Task title</Label>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <Label htmlFor={`${id}-due`}>Due date (optional)</Label>
          <Input
            id={`${id}-due`}
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function MemberAvatar({ webId }: { webId: string }) {
  const { displayName } = useProfile(webId);
  const name = displayName || webId;
  return (
    <li className="chat-member" title={name}>
      <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <span className="sr-only">{name}</span>
    </li>
  );
}
export function RoomView({ url, messageId }: { url: string; messageId?: string | undefined }) {
  const room = useRoom(url);
  const joined = useRooms();
  const messages = useMessages(url, room.data?.created);
  const send = useSend(url);
  const actions = useChatActions();
  const { session, client, details, setDetails, setCurrentRoom } = useChat();
  const [editing, setEditing] = useState<Message>();
  const [deleting, setDeleting] = useState<Message>();
  const [task, setTask] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const read = useRef(0);
  const [renderedAt, setRenderedAt] = useState(0);
  const [messageNotice, setMessageNotice] = useState("");
  const historyRequest = useRef(false);
  const jump = useRef({ messageId, pages: 0, cursor: "" });
  const member = room.data?.members.includes(session.webId);
  const isJoined = joined.data?.some((room) => room.url === url);
  useEffect(() => {
    setCurrentRoom(url);
  }, [url, setCurrentRoom]);
  useEffect(() => {
    if (jump.current.messageId !== messageId) {
      jump.current = { messageId, pages: 0, cursor: "" };
      setMessageNotice("");
    }
    if (!messageId || !messages.data || messages.status !== "ready") return;
    if (messages.data.messages.some((message) => message.id === messageId)) {
      setMessageNotice("");
      return;
    }
    const cursor = messages.data.next?.toISOString();
    if (!cursor || jump.current.pages >= 4) {
      setMessageNotice("This message couldn't be found in the loaded history.");
      return;
    }
    // A paging render can still expose the previous snapshot. Consume each cursor once.
    if (jump.current.cursor === cursor) return;
    jump.current.cursor = cursor;
    jump.current.pages++;
    historyRequest.current = true;
    messages.loadOlder();
  }, [messageId, messages.data, messages.status, messages.loadOlder]);
  // Only mark the visible snapshot read while this tab has the user's attention.
  // A monotonic local fence prevents preference notifications causing a write loop.
  useEffect(() => {
    const mark = () => {
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        !isJoined ||
        !messages.data ||
        !room.data
      )
        return;
      const at = renderedAt;
      if (at <= read.current) return;
      read.current = at;
      void actions.markRead(url, new Date(at)).catch(() => {
        read.current = 0;
        toast.error("Couldn't save your read position");
      });
    };
    mark();
    addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [actions, url, isJoined, messages.data, room.data, renderedAt]);
  const copy = () => {
    void navigator.clipboard.writeText(client.inviteLink(url, location.origin)).then(
      () => toast.success("Invite link copied"),
      () => toast.error("Couldn't copy invite link"),
    );
  };
  const notice = (
    <p key="message-notice" className="chat-message-notice" role="status" aria-atomic="true">
      {messageNotice}
    </p>
  );
  if (!room.data && room.status === "loading")
    return (
      <div className="chat-room">
        {notice}
        <LoadingSkeleton preset="list" label="Opening conversation" />
      </div>
    );
  if (!room.data)
    return (
      <div className="chat-state">
        {notice}
        <ChatFailure error={room.error} retry={room.retry} />
        <Composer
          url={url}
          send={send.send}
          editing={undefined}
          onEdit={setEditing}
          lastOwn={undefined}
          disabledReason="The room couldn't be loaded. Retry to send a message."
        />
      </div>
    );
  const data = room.data;
  const canRewrite = data.creator === session.webId;
  const list = messages.data?.messages ?? [];
  const lastOwn = [...list]
    .reverse()
    .find((message) => message.author === session.webId && !message.deleted);
  return (
    <div className="chat-room">
      <header className="chat-room-header">
        <span className="chat-room-symbol" aria-hidden="true">
          <MessageSquare size={22} />
        </span>
        <div className="chat-room-heading">
          <h1>
            <RoomName room={data} />
          </h1>
          <ul className="chat-members" aria-label={`${data.members.length} members`}>
            {data.members.slice(0, 4).map((member) => (
              <MemberAvatar key={member} webId={member} />
            ))}
            {data.members.length > 4 && <li>+{data.members.length - 4}</li>}
          </ul>
          {!session.subscribe && <p className="chat-hint">Updates every 30 s</p>}
        </div>
        <IconButton label="Copy invite link" variant="ghost" onClick={copy}>
          <Copy size={18} aria-hidden="true" />
        </IconButton>
        {isJoined && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void actions
                .leave(url)
                .catch(() => toast.error("Couldn't leave this room"))
                .finally(() => setBusy(false));
            }}
          >
            Leave room
          </Button>
        )}
        <IconButton
          label={details ? "Hide details" : "Show details"}
          variant="ghost"
          aria-pressed={details}
          onClick={() => setDetails(!details)}
        >
          <Info size={20} aria-hidden="true" />
        </IconButton>
      </header>
      {room.status === "error" && <ChatFailure error={room.error} retry={room.retry} />}
      {messages.status === "error" && <ChatFailure error={messages.error} retry={messages.retry} />}
      {notice}
      {!messages.data && messages.status === "error" ? (
        <div className="chat-timeline" />
      ) : !messages.data ? (
        <LoadingSkeleton preset="list" label="Loading messages" />
      ) : (
        <Timeline
          url={url}
          messages={list}
          messageId={messageId}
          historyLoading={historyRequest}
          outgoing={send.data}
          loading={messages.status === "loading"}
          hasOlder={!!messages.data.next}
          canRewrite={canRewrite}
          onRendered={setRenderedAt}
          loadOlder={messages.loadOlder}
          onEdit={setEditing}
          onDelete={(message) => {
            setDeleteError("");
            setDeleting(message);
          }}
          onTask={setTask}
          retry={send.retry}
          discard={send.discard}
        />
      )}
      {joined.status === "error" && joined.data && (
        <ChatFailure error={joined.error} retry={joined.retry} />
      )}
      {joined.status === "error" && !joined.data ? (
        <ChatFailure error={joined.error} retry={joined.retry} />
      ) : !isJoined || !member ? (
        <div className="chat-join">
          <p>
            {isJoined
              ? "This account is not a member. Ask the room creator for posting access."
              : "Join this conversation to keep it in your room list."}
          </p>
          <Button
            disabled={
              busy || isJoined || joined.status !== "ready" || room.status !== "ready" || !member
            }
            onClick={() => {
              setBusy(true);
              void actions
                .join(url)
                .catch(() => toast.error("Couldn't join this room"))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Joining…" : "Join room"}
          </Button>
        </div>
      ) : (
        <Composer
          url={url}
          send={send.send}
          editing={editing}
          onEdit={setEditing}
          lastOwn={canRewrite ? lastOwn : undefined}
          disabledReason={
            !member
              ? "You aren't a member of this room. Ask its creator for posting access."
              : messages.status === "error"
                ? "Messages couldn't be loaded. Retry to send a message."
                : undefined
          }
        />
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(undefined)}
      >
        <AlertDialogContent className="chat-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              The message text will be replaced with “Message deleted”. Replies keep their place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (!deleting) return;
                setBusy(true);
                void actions
                  .remove(url, deleting.id)
                  .then(
                    () => setDeleting(undefined),
                    () => setDeleteError("Couldn't delete the message. Try again."),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Deleting…" : "Delete message"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {task && <TaskDialog message={task} url={url} onClose={() => setTask(undefined)} />}
    </div>
  );
}
/** Reads the room ref on the client so the native export's placeholder page works too. */
export function RoomPageRoute() {
  const params = usePageRouteParams<{ ref: string }>("/chat/r/[ref]");
  if (!params)
    return (
      <div className="chat-state" role="status">
        Opening this conversation…
      </div>
    );
  return <RoomRoute reference={params.ref} />;
}
export function RoomRoute({ reference }: { reference: string }) {
  return (
    <Suspense>
      <RoomRouteContent reference={reference} />
    </Suspense>
  );
}
function RoomRouteContent({ reference }: { reference: string }) {
  const messageReference = useSearchParams().get("message");
  const { client } = useChat();
  let url: string;
  let messageId: string | undefined;
  try {
    url = invitationRoom(decodeRef(reference), client.storageUrl);
  } catch {
    return (
      <div className="chat-state" role="alert">
        <h1>This room link isn't valid</h1>
        <p>Ask the sender to copy the invite link again.</p>
        <a href="/chat">Back to Chat</a>
      </div>
    );
  }
  // A malformed message hint must never invalidate an otherwise usable room link.
  try {
    if (messageReference) messageId = decodeIdentifierRef(messageReference);
  } catch {
    messageId = undefined;
  }
  if (!client.canOpen(url))
    return (
      <div className="chat-state" role="alert">
        <h1>This conversation is in another pod</h1>
        <p>
          This conversation is in another pod. Opening conversations in other pods arrives with
          sign-in.
        </p>
        <a href="/chat">Back to Chat</a>
      </div>
    );
  return <RoomView key={url} url={url} messageId={messageId} />;
}
