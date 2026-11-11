// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { Invitation } from "../lib/client";
import { useAsync, useChat } from "../state/chat-context";

const DISMISSALS_CHANGED = "chat-invitation-dismissals-changed";
const dismissalKey = (webId: string) =>
  `chat.invitation-dismissals.v1:${encodeURIComponent(webId)}`;
function readDismissals(webId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(dismissalKey(webId)) ?? "[]");
    return Array.isArray(value)
      ? value.filter((room): room is string => typeof room === "string").slice(-200)
      : [];
  } catch {
    return [];
  }
}
function senderHost(actor: string | undefined): string {
  try {
    const url = new URL(actor ?? "");
    return ["https:", "http:"].includes(url.protocol) && url.host
      ? `From ${url.host}`
      : "Unknown sender";
  } catch {
    return "Unknown sender";
  }
}
function InvitationRow({ invitation, dismiss }: { invitation: Invitation; dismiss: () => void }) {
  const { client } = useChat();
  const room = useAsync(
    useCallback((signal) => client.room(invitation.room, { signal }), [client, invitation]),
    false,
  );
  return (
    <li className="chat-invitation">
      <Link href={`/chat/r/${encodeRef(invitation.room)}`} className="chat-room-link">
        {room.data?.name || "Room invitation"}
      </Link>
      <p className="chat-hint">{senderHost(invitation.actor)}</p>
      <Button variant="ghost" size="sm" onClick={dismiss}>
        Dismiss
      </Button>
    </li>
  );
}
export function Invitations() {
  const { client, session } = useChat();
  const result = useAsync(useCallback((signal) => client.invitations({ signal }), [client]));
  const [dismissals, setDismissals] = useState(() => ({
    webId: session.webId,
    rooms: readDismissals(session.webId),
  }));
  const hidden =
    dismissals.webId === session.webId ? dismissals.rooms : readDismissals(session.webId);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event.type === "storage" && (event as StorageEvent).key !== dismissalKey(session.webId))
        return;
      setDismissals({ webId: session.webId, rooms: readDismissals(session.webId) });
    };
    window.addEventListener(DISMISSALS_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DISMISSALS_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, [session.webId]);
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
  const visible = result.data?.filter((invitation) => !hidden.includes(invitation.room)) ?? [];
  const dismiss = (room: string) => {
    const rooms = [...hidden.filter((value) => value !== room), room].slice(-200);
    setDismissals({ webId: session.webId, rooms });
    try {
      localStorage.setItem(dismissalKey(session.webId), JSON.stringify(rooms));
      window.dispatchEvent(new Event(DISMISSALS_CHANGED));
    } catch {
      /* Unavailable storage still permits dismissal for this mount. */
    }
  };
  const failure = result.status === "error" && (
    <p className="chat-hint" role="status">
      Couldn't load invitations.{" "}
      <Button variant="ghost" size="sm" onClick={result.retry}>
        Retry invitations
      </Button>
    </p>
  );
  if (!visible.length) return failure || null;
  return (
    <section aria-label="Invitations">
      {visible.length > 0 && <h2>Invitations</h2>}
      {visible.length > 0 && (
        <ul>
          {visible.map((invitation) => (
            <InvitationRow
              key={invitation.room}
              invitation={invitation}
              dismiss={() => dismiss(invitation.room)}
            />
          ))}
        </ul>
      )}
      {failure}
    </section>
  );
}
