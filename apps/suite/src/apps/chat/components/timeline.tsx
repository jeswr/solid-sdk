// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal, SmilePlus } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Message } from "../lib/client";
import { buildTimeline, visibleReactions } from "../lib/timeline";
import { type Outgoing, useChat, useChatActions } from "../state/chat-context";
import { useProfile } from "./chat-app";
import { MessageText } from "./message-text";

type TimelineMessage = Message & { status?: "sending" | "failed" | undefined };
const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀"];
function ReactionChoices({ react }: { react: (emoji: string) => void }) {
  return REACTION_EMOJI.map((emoji) => (
    <DropdownMenuItem key={emoji} aria-label={`React with ${emoji}`} onSelect={() => react(emoji)}>
      {emoji}
    </DropdownMenuItem>
  ));
}
function dayLabel(day: string) {
  const now = new Date();
  const key = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (day === key(now)) return "Today";
  now.setDate(now.getDate() - 1);
  return day === key(now)
    ? "Yesterday"
    : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" });
}
function MessageArticle({
  url,
  message,
  grouped,
  tabIndex,
  onFocus,
  onEdit,
  onDelete,
  onTask,
  retry,
  discard,
  canRewrite,
  highlighted,
}: {
  url: string;
  message: TimelineMessage;
  grouped: boolean;
  tabIndex: number;
  onFocus: () => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onTask: (message: Message) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
  canRewrite: boolean;
  highlighted: boolean;
}) {
  const { session } = useChat();
  const actions = useChatActions();
  // A ref guards double submits; chips stay focusable (aria-disabled) so focus is never dropped.
  // IconButton's `disabled` is aria-disabled too, so the picker returns focus to its trigger.
  const busy = useRef(false);
  const [reacting, setReacting] = useState(false);
  const chips = useRef<HTMLFieldSetElement>(null);
  const addReaction = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const react = (emoji: string) => {
    if (busy.current) return;
    busy.current = true;
    refocus.current = !!chips.current?.contains(document.activeElement);
    setReacting(true);
    void actions
      .react(url, message.id, emoji)
      .catch(() => {
        refocus.current = false;
        toast.error("Couldn't update reaction");
      })
      .finally(() => {
        busy.current = false;
        setReacting(false);
      });
  };
  // Removing the last reaction of an emoji unmounts the focused chip; keep focus in the message.
  useLayoutEffect(() => {
    // Only the first refresh after a finished write may move focus; a chip that survives that
    // refresh clears the request, so a later poll never steals focus or scrolls the timeline.
    if (!message.reactions || !refocus.current || busy.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    addReaction.current?.focus();
  }, [message.reactions]);
  const { shown, hidden } = visibleReactions(message.reactions);
  const profile = useProfile(message.author ?? "");
  const name = profile.displayName || message.author || "Unknown author";
  const time = message.published
    ? new Date(message.published).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown time";
  return (
    <article
      className="chat-message"
      data-message-id={message.id}
      data-highlighted={highlighted ? "" : undefined}
      data-grouped={grouped ? "" : undefined}
      tabIndex={tabIndex}
      aria-label={`${name}, ${time}`}
      onFocus={onFocus}
    >
      <span className="chat-avatar" aria-hidden="true">
        {grouped ? "" : name.slice(0, 1).toUpperCase()}
      </span>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          {!grouped && <strong>{name}</strong>}
          <time className="chat-timestamp" dateTime={message.published} title={message.published}>
            {time}
          </time>
          {message.edited && <span className="chat-edited">edited</span>}
        </div>
        {message.deleted ? (
          <p className="chat-deleted">Message deleted</p>
        ) : (
          <MessageText text={message.content} />
        )}
        {message.task && !message.deleted && (
          <p className="chat-task-marker">Task: {message.task.title}</p>
        )}
        {!message.deleted && !message.status && message.reactions.length > 0 && (
          <fieldset ref={chips} className="chat-reactions" aria-label="Reactions">
            {shown.map(({ emoji, count, reactedByMe }) => (
              <Button
                key={emoji}
                size="sm"
                variant="outline"
                className="chat-reaction"
                aria-pressed={reactedByMe}
                aria-label={`${emoji} ${count} ${count === 1 ? "reaction" : "reactions"}${reactedByMe ? ", including you" : ""}`}
                aria-disabled={reacting || undefined}
                onClick={() => react(emoji)}
              >
                <span aria-hidden="true">{emoji}</span> {count}
              </Button>
            ))}
            {hidden > 0 && <span className="chat-reaction-more">+{hidden} more</span>}
          </fieldset>
        )}
        {message.status === "sending" && <p className="chat-delivery">Sending…</p>}
        {message.status === "failed" && (
          <div className="chat-send-failure" role="status">
            <span>Couldn't send message.</span>
            <Button size="sm" variant="outline" onClick={() => retry(message.id)}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => discard(message.id)}>
              Discard
            </Button>
          </div>
        )}
      </div>
      {!message.deleted && !message.status && (
        <div className="chat-message-tools">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                ref={addReaction}
                label="Add reaction"
                size="icon-sm"
                variant="ghost"
                disabled={reacting}
              >
                <SmilePlus size={18} aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="chat-reaction-picker"
              aria-label="Add reaction"
            >
              <ReactionChoices react={react} />
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="Message actions"
                className="chat-message-menu"
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-message-actions">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={reacting}>Add reaction</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent
                    className="chat-reaction-picker"
                    aria-label="Add reaction"
                  >
                    <ReactionChoices react={react} />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              {message.author === session.webId && canRewrite && (
                <>
                  <DropdownMenuItem onSelect={() => onEdit(message)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDelete(message)}>Delete</DropdownMenuItem>
                </>
              )}
              {!canRewrite && (
                <DropdownMenuLabel className="chat-hint">
                  Editing needs write access to this room
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem onSelect={() => onTask(message)}>Turn into task</DropdownMenuItem>
              {message.author !== session.webId && (
                <DropdownMenuItem
                  onSelect={() => {
                    void navigator.clipboard.writeText(message.content).then(
                      () => toast.success("Message copied"),
                      () => toast.error("Couldn't copy message"),
                    );
                  }}
                >
                  Copy text
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </article>
  );
}
export function Timeline({
  url,
  messages,
  messageId,
  historyLoading,
  outgoing,
  loading,
  hasOlder,
  loadOlder,
  onEdit,
  onDelete,
  onTask,
  retry,
  discard,
  canRewrite,
  onRendered,
}: {
  url: string;
  messages: Message[];
  messageId?: string | undefined;
  historyLoading?: RefObject<boolean>;
  outgoing: Outgoing[];
  loading: boolean;
  hasOlder: boolean;
  loadOlder: () => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onTask: (message: Message) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
  canRewrite: boolean;
  onRendered?: (at: number) => void;
}) {
  const { session } = useChat();
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const known = useRef<Set<string> | null>(null);
  const nearBottom = useRef(true);
  const ownHistoryRequest = useRef(false);
  const historyRequest = historyLoading ?? ownHistoryRequest;
  const [announcement, setAnnouncement] = useState("");
  const [focused, setFocused] = useState<string>();
  const target = useRef<string | undefined>(undefined);
  const [windowStart, setWindowStart] = useState(0);
  const heights = useRef(new Map<string, number>());
  const jumpedTo = useRef<string | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<string>();
  const all = useMemo(
    () =>
      [
        ...new Map<string, TimelineMessage>(
          [...outgoing, ...messages].map((message) => [message.id, message]),
        ).values(),
      ].sort(
        (a, b) => (a.published ?? "").localeCompare(b.published ?? "") || a.id.localeCompare(b.id),
      ),
    [messages, outgoing],
  );
  const rows = useMemo(() => {
    const items = buildTimeline(
      {
        roomId: url,
        lastRead: 253402300799999,
        messages: all.map((message) => ({
          ...message,
          roomId: url,
          senderId: message.author || "unknown",
          timestamp: message.published ? Date.parse(message.published) : 0,
        })),
      },
      { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, groupWithinMinutes: 5 },
    ).items;
    let day: string | undefined;
    return items.flatMap((item) => {
      if (item.kind === "day-divider") {
        day = item.date;
        return [];
      }
      if (item.kind !== "message-group") return [];
      return item.messages.map((message, index) => {
        const divider = day;
        day = undefined;
        return { message, grouped: index > 0, day: divider };
      });
    });
  }, [all, url]);
  const virtual = rows.length > 200;
  const start = virtual ? Math.max(0, Math.min(windowStart, rows.length - 200)) : 0;
  const rendered = rows.slice(start, start + 200);
  const newestRendered = rendered.reduce(
    (at, { message }) =>
      !message.status && message.published ? Math.max(at, Date.parse(message.published)) : at,
    0,
  );
  useEffect(() => {
    onRendered?.(newestRendered);
  }, [newestRendered, onRendered]);
  const heightOf = (id: string) => heights.current.get(id) ?? 80;
  const topHeight = rows.slice(0, start).reduce((sum, row) => sum + heightOf(row.message.id), 0);
  const bottomHeight = rows
    .slice(start + 200)
    .reduce((sum, row) => sum + heightOf(row.message.id), 0);
  useEffect(() => {
    const ids = new Set(messages.map((message) => message.id));
    if (known.current) {
      const added = messages.filter(
        (message) =>
          !known.current?.has(message.id) && message.author !== session.webId && !message.deleted,
      );
      // Backwards pages are explicitly anchored, and never announce history.
      if (!historyRequest.current && added.length)
        setAnnouncement(
          `${added.length} new ${added.length === 1 ? "message" : "messages"}. ${added.map((message) => message.content).join(" ")}`,
        );
    }
    known.current = ids;
    if (!loading) historyRequest.current = false;
  }, [messages, session.webId, loading, historyRequest]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    for (const row of node.querySelectorAll<HTMLElement>("[data-row-id]"))
      heights.current.set(row.dataset.rowId as string, row.getBoundingClientRect().height);
    // A pending deep link owns the window; automatic bottom scrolling could unmount its article.
    if (
      messageId &&
      jumpedTo.current !== messageId &&
      rows.some((row) => row.message.id === messageId)
    ) {
      nearBottom.current = false;
      anchor.current = null;
      return;
    }
    if (anchor.current && !loading) {
      const mark = anchor.current;
      const index = rows.findIndex((row) => row.message.id === mark.id);
      if (virtual && index >= 0 && (index < start || index >= start + 200)) {
        setWindowStart(Math.max(0, index - 30));
        return;
      }
      const target = [...node.querySelectorAll<HTMLElement>("[data-message-id]")].find(
        (row) => row.dataset.messageId === mark.id,
      );
      if (target) {
        node.scrollTop += target.getBoundingClientRect().top - mark.top;
        anchor.current = null;
      }
    } else if (nearBottom.current && !anchor.current) {
      if (virtual && start !== rows.length - 200) setWindowStart(rows.length - 200);
      else node.scrollTop = node.scrollHeight;
    }
  }, [messageId, rows, start, virtual, loading]);
  useLayoutEffect(() => {
    if (!messageId) {
      jumpedTo.current = undefined;
      return;
    }
    if (jumpedTo.current === messageId) return;
    const index = rows.findIndex((row) => row.message.id === messageId);
    if (index < 0) return;
    nearBottom.current = false;
    anchor.current = null;
    target.current = messageId;
    setFocused(messageId);
    if (virtual && (index < start || index >= start + 200)) {
      setWindowStart(Math.max(0, Math.min(rows.length - 200, index - 30)));
      return;
    }
    const article = [
      ...(scroll.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []),
    ].find((node) => node.dataset.messageId === messageId);
    if (!article) return;
    jumpedTo.current = messageId;
    article.scrollIntoView?.({ block: "center", behavior: "auto" });
    if (
      !(
        document.activeElement instanceof Element &&
        document.activeElement.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        )
      )
    )
      article.focus({ preventScroll: true });
    setHighlighted(messageId);
  }, [messageId, rows, start, virtual]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(undefined), 3000);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const older = () => {
    if (loading || !hasOlder) return;
    const node = scroll.current;
    const first = [...(node?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])].find(
      (row) => row.getBoundingClientRect().bottom > (node?.getBoundingClientRect().top ?? 0),
    );
    if (first)
      anchor.current = {
        id: first.dataset.messageId as string,
        top: first.getBoundingClientRect().top,
      };
    nearBottom.current = false;
    historyRequest.current = true;
    loadOlder();
  };
  const focusIndex = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setFocused(row.message.id);
    target.current = row.message.id;
    if (virtual) setWindowStart(Math.max(0, Math.min(rows.length - 200, index - 30)));
    nearBottom.current = false;
    const article = () =>
      [...(scroll.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])].find(
        (node) => node.dataset.messageId === row.message.id,
      );
    // Focus a rendered row now, so Enter right after an arrow key acts on the new row; a row
    // outside the virtual window is focused once it has rendered.
    const rendered = article();
    if (rendered) rendered.focus();
    else requestAnimationFrame(() => article()?.focus());
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button,a,[role=menu]")) return;
    // A fast second key press arrives before the first one's focus has rendered, so read the
    // latest target from a ref rather than from state or the DOM.
    const current = target.current ?? focused;
    const index = rows.findIndex((row) => row.message.id === current);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusIndex(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : index < 0
              ? event.key === "ArrowUp"
                ? rows.length - 1
                : 0
              : index + (event.key === "ArrowUp" ? -1 : 1),
      );
    }
    if (
      (event.key === "Enter" || (event.key === "F10" && event.shiftKey)) &&
      event.target instanceof HTMLElement &&
      event.target.matches("article")
    ) {
      event.preventDefault();
      event.target.querySelector<HTMLButtonElement>('[aria-label="Message actions"]')?.focus();
      event.target
        .querySelector<HTMLButtonElement>('[aria-label="Message actions"]')
        ?.dispatchEvent(
          new globalThis.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
    }
  };
  return (
    <div
      className="chat-timeline"
      ref={scroll}
      role="log"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions text"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the message log is a keyboard navigation entry point
      tabIndex={0}
      onKeyDown={keyboard}
      onScroll={() => {
        const node = scroll.current;
        if (!node) return;
        nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        if (virtual && !anchor.current) {
          let cumulative = 0;
          let index = 0;
          while (index < rows.length && cumulative < node.scrollTop) {
            cumulative += heightOf(rows[index]?.message.id as string);
            index++;
          }
          const nextStart = Math.max(0, Math.min(rows.length - 200, index - 30));
          if (nextStart !== start) {
            const first = [...node.querySelectorAll<HTMLElement>("[data-message-id]")].find(
              (row) => row.getBoundingClientRect().bottom > node.getBoundingClientRect().top,
            );
            if (first)
              anchor.current = {
                id: first.dataset.messageId as string,
                top: first.getBoundingClientRect().top,
              };
            setWindowStart(nextStart);
          }
        }
        if (node.scrollTop <= 2 && node.scrollHeight > node.clientHeight) older();
      }}
    >
      <div aria-live="off">
        <div className="chat-history-action">
          {hasOlder && (
            <Button variant="ghost" size="sm" onClick={older} disabled={loading}>
              {loading ? "Loading earlier messages…" : "Load earlier messages"}
            </Button>
          )}
        </div>
        {virtual && <div style={{ height: topHeight }} aria-hidden="true" />}
        {rendered.map(({ message, grouped, day }) => (
          <div key={message.id} data-row-id={message.id}>
            {day && (
              <div className="chat-day">
                <span>{dayLabel(day)}</span>
              </div>
            )}
            <MessageArticle
              url={url}
              message={message}
              grouped={grouped}
              highlighted={highlighted === message.id}
              tabIndex={focused === message.id ? 0 : -1}
              onFocus={() => setFocused(message.id)}
              onEdit={onEdit}
              onDelete={onDelete}
              onTask={onTask}
              retry={retry}
              discard={discard}
              canRewrite={canRewrite}
            />
          </div>
        ))}
        {virtual && <div style={{ height: bottomHeight }} aria-hidden="true" />}
        {!all.length && !loading && (
          <p className="chat-first-message">
            This is the beginning of your conversation. Say hello.
          </p>
        )}
      </div>
      <div className="sr-only" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
