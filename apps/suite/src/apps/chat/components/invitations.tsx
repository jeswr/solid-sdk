// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
const claimKey = (invitation: Invitation) => JSON.stringify([invitation.room, invitation.actor]);
function InvitationRow({
  invitation,
  dismiss,
  ignore,
}: {
  invitation: Invitation;
  dismiss(): void;
  ignore(key: string): void;
}) {
  const { client } = useChat();
  const roomUrl = invitation.room;
  const room = useAsync(
    useCallback((signal) => client.room(roomUrl, { signal }), [client, roomUrl]),
    false,
  );
  const invalid =
    !!room.data && (!invitation.actor || !room.data.members.includes(invitation.actor));
  const key = `${client.webId}:${claimKey(invitation)}`;
  useEffect(() => {
    if (invalid) ignore(key);
  }, [invalid, ignore, key]);
  if (invalid) return null;
  const name =
    room.data?.name || `Room invitation (${new URL(roomUrl).pathname.split("/").at(-2)})`;
  return (
    <li className="chat-invitation" data-room={roomUrl}>
      <Link href={`/chat/r/${encodeRef(roomUrl)}`} className="chat-room-link">
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
  const name = `Room invitation (${invitation.room})`;
  return (
    <li className="chat-invitation" data-room={invitation.room}>
      <span>{name}</span>
      <p className="chat-hint">{senderHost(invitation.actor)}</p>
      <p className="chat-hint">Opens when Chat supports rooms in other pods</p>
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
export function Invitations() {
  const { client, session } = useChat();
  const result = useAsync(
    useCallback((signal) => client.invitations({ signal }), [client]),
    false,
  );
  const store = useMemo(() => invitationDismissals(session.webId), [session.webId]);
  const [dismissals, setDismissals] = useState(() => ({ store, rooms: store.load() }));
  const hidden = dismissals.store === store ? dismissals.rooms : store.load();
  const [ignored, setIgnored] = useState<string[]>([]);
  const ignore = useCallback(
    (key: string) => setIgnored((keys) => (keys.includes(key) ? keys : [...keys, key])),
    [],
  );
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextFocus = useRef<string | null | undefined>(undefined);
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
  const visible =
    result.data?.filter(
      (invitation) =>
        !hidden.has(invitation.room) &&
        !ignored.includes(`${session.webId}:${claimKey(invitation)}`),
    ) ?? [];
  const own = visible.filter((invitation) => client.canOpen(invitation.room));
  const foreign = visible.filter((invitation) => !client.canOpen(invitation.room));
  const dismiss = (rooms: string[]) => {
    const rows = Array.from(section.current?.querySelectorAll<HTMLElement>("[data-room]") ?? []);
    const index = rows.findIndex((row) => row.dataset.room === rooms[0]);
    nextFocus.current =
      rows.slice(index + 1).find((row) => !rooms.includes(row.dataset.room as string))?.dataset
        .room ?? null;
    setRetainHeading(session.webId);
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
  const foreignRows = (
    <ul>
      {foreign.map((invitation) => (
        <ForeignInvitationRow
          key={invitation.room}
          invitation={invitation}
          dismiss={() => dismiss([invitation.room])}
        />
      ))}
    </ul>
  );
  return (
    <section ref={section} aria-labelledby={headingId}>
      <h2 ref={heading} id={headingId} tabIndex={-1}>
        Invitations
      </h2>
      {!!own.length && (
        <ul>
          {own.map((invitation) => (
            <InvitationRow
              key={invitation.room}
              invitation={invitation}
              dismiss={() => dismiss([invitation.room])}
              ignore={ignore}
            />
          ))}
        </ul>
      )}
      {!!foreign.length && (
        <>
          {foreign.length > 3 ? (
            <details>
              <summary>{foreign.length} invitations from other pods</summary>
              {foreignRows}
            </details>
          ) : (
            foreignRows
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismiss(foreign.map((invitation) => invitation.room))}
          >
            Dismiss all
          </Button>
        </>
      )}
      {failure}
    </section>
  );
}
