// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";

/** `/permissions/requests` (03-home-permissions §2.5): pending requests and 30 days of decisions. */

import {
  Avatar,
  AvatarFallback,
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useRef, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { permissionDate } from "../../lib/permissions/view";
import { requestedDurationText } from "../../lib/requests/duration";
import {
  cardLabels,
  decidedText,
  initials,
  purposeLine,
  type ReadableRequest,
  requestCards,
  requesterHost,
  requesterName,
} from "../../lib/requests/model";
import { useRequests } from "../../state/requests";
import { RequestReview } from "./request-review";

export const EMPTY_PENDING =
  "No requests waiting — when an app or person asks for access, it appears here.";
export const EMPTY_DECIDED = "No requests decided in the last 30 days.";

function Requester({ entry }: { entry: ReadableRequest }) {
  const name = requesterName(entry);
  const host = requesterHost(entry);
  return (
    <div className="hm-request-who">
      <Avatar aria-hidden="true">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div>
        <h3 className="hm-request-name">{name}</h3>
        {host && host !== name && <p className="hm-request-muted">{host}</p>}
      </div>
    </div>
  );
}

export function RequestRow({
  entry,
  onReview,
}: {
  entry: ReadableRequest;
  onReview?: ((entry: ReadableRequest, trigger: HTMLElement) => void) | undefined;
}) {
  const purpose = purposeLine(entry.purpose);
  return (
    <li className="hm-request-row" aria-label={`Request from ${requesterName(entry)}`}>
      <Requester entry={entry} />
      <div className="hm-request-details">
        <p className="hm-request-types">{cardLabels(requestCards(entry)).join(", ")}</p>
        {purpose && <p>{purpose}</p>}
        <p className="hm-request-muted">
          {!onReview
            ? decidedText(entry, permissionDate)
            : entry.status === "approving"
              ? "Approving didn't finish"
              : requestedDurationText(entry, permissionDate)}
        </p>
      </div>
      {onReview && (
        <Button variant="outline" onClick={(event) => onReview(entry, event.currentTarget)}>
          {entry.status === "approving" ? "Finish approving" : "Review"}
        </Button>
      )}
    </li>
  );
}

/** Inbox items nothing here can answer, as one quiet line; dismissable for the session. */
export function unreadableText(count: number): string {
  return count === 1
    ? "1 item in your inbox isn't an access request or couldn't be read."
    : `${count} items in your inbox aren't access requests or couldn't be read.`;
}

export function UnreadableNote({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div className="hm-request-note">
      <p className="hm-request-muted">{unreadableText(count)}</p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

export function RequestsPage() {
  const requests = useRequests();
  const [tab, setTab] = useState("pending");
  const [reviewing, setReviewing] = useState<ReadableRequest>();
  const trigger = useRef<HTMLElement | null>(null);
  // Unreadable inbox items can't be answered, so they never count as waiting.
  const waiting = requests.pending.length;
  const list = (entries: readonly ReadableRequest[], pending: boolean) =>
    requests.status === "loading" ? (
      <LoadingSkeleton preset="list" count={3} label="Loading requests" />
    ) : requests.status === "error" ? (
      <ErrorState error="unreachable" actions={{ retry: () => void requests.refresh() }} />
    ) : entries.length ? (
      <ul className="hm-request-list">
        {entries.map((entry) => (
          <RequestRow
            key={entry.id}
            entry={entry}
            onReview={
              pending
                ? (next, button) => {
                    trigger.current = button;
                    setReviewing(next);
                  }
                : undefined
            }
          />
        ))}
      </ul>
    ) : (
      <EmptyState title={pending ? EMPTY_PENDING : EMPTY_DECIDED} body="" />
    );
  return (
    <div className="hm-page hm-requests-page">
      <header>
        <Link className="hm-request-back" href="/permissions">
          Permissions
        </Link>
        <AppHeading>Requests</AppHeading>
        <p className="hm-request-muted">Apps and people asking to use data in your pod.</p>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Requests" variant="line">
          <TabsTrigger value="pending">
            Pending
            {waiting > 0 && (
              <span className="hm-permission-count">
                {waiting}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="decided">Decided</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          {list(requests.pending, true)}
          {requests.status === "ready" &&
            requests.unreadable.length > 0 &&
            !requests.unreadableDismissed && (
              <UnreadableNote
                count={requests.unreadable.length}
                onDismiss={requests.dismissUnreadable}
              />
            )}
        </TabsContent>
        <TabsContent value="decided">{list(requests.decided, false)}</TabsContent>
      </Tabs>
      {reviewing && (
        <RequestReview
          key={reviewing.id}
          entry={reviewing}
          onDone={() => {
            setReviewing(undefined);
            // The row may be gone once decided; fall back to the tab list.
            const target = trigger.current?.isConnected
              ? trigger.current
              : document.querySelector<HTMLElement>(
                  ".hm-requests-page [role=tab][data-state=active]",
                );
            requestAnimationFrame(() => target?.focus());
          }}
        />
      )}
    </div>
  );
}
