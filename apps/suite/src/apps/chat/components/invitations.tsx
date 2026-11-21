// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { Invitation } from "../lib/client";
import { useAsync, useChat } from "../state/chat-context";
import {
  DISMISSALS_CHANGED,
  INVITATIONS_JOINED,
  invitationDismissalKey,
  invitationDismissals,
} from "../state/local-state";

function senderHost(actor: string | undefined): string {
  try {
    const url = new URL(actor ?? "");
    return ["https:", "http:"].includes(url.protocol) && url.host
      ? `Invitation claims to be from ${url.host}`
      : "Unknown sender";
  } catch {
    return "Unknown sender";
  }
}
/** Host and room slug: short enough to tell rows apart in a button name. */
function roomLabel(room: string): string {
  const url = new URL(room);
  return `${url.host}/${url.pathname.split("/").at(-2)}`;
}
function InvitationRow({ invitation, dismiss }: { invitation: Invitation; dismiss(): void }) {
  const name =
    invitation.name || `Room invitation (${new URL(invitation.room).pathname.split("/").at(-2)})`;
  return (
    <li className="chat-invitation" data-room={invitation.room}>
      <Link href={`/chat/r/${encodeRef(invitation.room)}`} className="chat-room-link">
        {name}
      </Link>
      <p className="chat-hint">{senderHost(invitation.actor)}</p>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Dismiss invitation to ${name}`}
        onClick={dismiss}
      >
        Dismiss
      </Button>
    </li>
  );
}
function ForeignInvitationRow({
  invitation,
  dismiss,
}: {
  invitation: Invitation;
  dismiss(): void;
}) {
  return (
    <li className="chat-invitation" data-room={invitation.room}>
      <span>Room invitation ({invitation.room})</span>
      <p className="chat-hint">{senderHost(invitation.actor)}</p>
      <p className="chat-hint">Opens when Chat supports rooms in other pods</p>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Dismiss invitation to ${roomLabel(invitation.room)}`}
        onClick={dismiss}
      >
        Dismiss
      </Button>
    </li>
  );
}
/** More than three rows collapse behind their count. */
function Collapsed({ summary, children }: { summary: string; children: ReactNode[] }) {
  const list = <ul>{children}</ul>;
  return children.length > 3 ? (
    <details>
      <summary>
        {children.length} {summary}
      </summary>
      {list}
    </details>
  ) : (
    list
  );
}
export function Invitations() {
  const { client, session } = useChat();
  // Sidebar and drawer copies share the client's in-flight scan, room checks included.
  const result = useAsync(
    useCallback((signal) => client.invitations({ signal }), [client]),
    false,
  );
  const store = useMemo(() => invitationDismissals(session.webId), [session.webId]);
  const [dismissals, setDismissals] = useState(() => ({ store, rooms: store.load() }));
  const hidden = dismissals.store === store ? dismissals.rooms : store.load();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextFocus = useRef<string | null | undefined>(undefined);
  // After the last dismissal, focus lands on the heading; the empty section goes once it leaves.
  const [retainHeading, setRetainHeading] = useState<string>();
  const headingId = useId();
  useEffect(() => {
    const sync = (event: Event) => {
      if (
        event.type === "storage" &&
        (event as StorageEvent).key !== invitationDismissalKey(session.webId)
      )
        return;
      const detail = (event as CustomEvent<{ webId: string; rooms: string[] }>).detail;
      if (event.type === DISMISSALS_CHANGED && detail?.webId !== session.webId) return;
      setDismissals({ store, rooms: detail?.rooms ? new Set(detail.rooms) : store.load() });
    };
    const joined = (event: Event) => {
      if ((event as CustomEvent).detail.webId === session.webId) result.retry();
    };
    window.addEventListener(DISMISSALS_CHANGED, sync);
    window.addEventListener("storage", sync);
    window.addEventListener(INVITATIONS_JOINED, joined);
    return () => {
      window.removeEventListener(DISMISSALS_CHANGED, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(INVITATIONS_JOINED, joined);
    };
  }, [session.webId, store, result.retry]);
  useEffect(() => {
    let lastRefresh = Date.now();
    const focus = () => {
      if (Date.now() - lastRefresh < 30_000) return;
      lastRefresh = Date.now();
      result.retry();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [result.retry]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dismissal commits remove the focused row before focus moves.
  useEffect(() => {
    if (nextFocus.current === undefined) return;
    const row = Array.from(
      section.current?.querySelectorAll<HTMLElement>("[data-room]") ?? [],
    ).find((row) => row.dataset.room === nextFocus.current);
    const collapsed = row?.closest("details")?.open === false;
    const target = (!collapsed && row?.querySelector<HTMLElement>("a, button")) || heading.current;
    target?.focus();
    nextFocus.current = undefined;
  }, [dismissals]);
  const visible = result.data?.filter((invitation) => !hidden.has(invitation.room)) ?? [];
  const own = visible.filter((invitation) => client.canOpen(invitation.room));
  const foreign = visible.filter((invitation) => !client.canOpen(invitation.room));
  const dismiss = (rooms: string[]) => {
    const rows = Array.from(section.current?.querySelectorAll<HTMLElement>("[data-room]") ?? []);
    const index = rows.findIndex((row) => row.dataset.room === rooms[0]);
    nextFocus.current =
      rows.slice(index + 1).find((row) => !rooms.includes(row.dataset.room as string))?.dataset
        .room ?? null;
    if (nextFocus.current === null) setRetainHeading(session.webId);
    const saved = new Set([...hidden, ...rooms].slice(-200));
    store.save(saved);
    setDismissals({ store, rooms: saved });
    window.dispatchEvent(
      new CustomEvent(DISMISSALS_CHANGED, { detail: { webId: session.webId, rooms: [...saved] } }),
    );
  };
  const failure = result.status === "error" && (
    <p className="chat-hint" role="status">
      Couldn't load invitations.{" "}
      <Button variant="ghost" size="sm" onClick={result.retry}>
        Retry invitations
      </Button>
    </p>
  );
  if (!visible.length && retainHeading !== session.webId) return failure || null;
  return (
    <section ref={section} aria-labelledby={headingId}>
      <h2 ref={heading} id={headingId} tabIndex={-1} onBlur={() => setRetainHeading(undefined)}>
        Invitations
      </h2>
      {!!own.length && (
        <Collapsed summary="room invitations in your pod">
          {own.map((invitation) => (
            <InvitationRow
              key={invitation.room}
              invitation={invitation}
              dismiss={() => dismiss([invitation.room])}
            />
          ))}
        </Collapsed>
      )}
      {!!foreign.length && (
        <Collapsed summary="invitations from other pods">
          {foreign.map((invitation) => (
            <ForeignInvitationRow
              key={invitation.room}
              invitation={invitation}
              dismiss={() => dismiss([invitation.room])}
            />
          ))}
        </Collapsed>
      )}
      {visible.length > 3 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dismiss(visible.map((invitation) => invitation.room))}
        >
          Dismiss all {visible.length} invitations
        </Button>
      )}
      {failure}
    </section>
  );
}
