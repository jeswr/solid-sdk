// AUTHORED-BY Claude Opus 5.5
"use client";
/** `/permissions/requests` (03-home-permissions §2.5): pending requests and 30 days of decisions. */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useRef, useState } from "react";
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
  reviewError,
  type UnreadableRequest,
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

export const UNREADABLE_TITLE = "Couldn't read this request";

/** A notification that couldn't be read: nothing in it can be shown or shared, only denied. */
export function UnreadableRow({
  entry,
  onDeny,
}: {
  entry: UnreadableRequest;
  onDeny: (entry: UnreadableRequest) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; retry: boolean }>();
  const busy = useRef(false);
  const deny = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setRefusal(undefined);
    try {
      await onDeny(entry);
      toast.success("You denied the request.");
    } catch (caught) {
      const failure = reviewError(caught, false, navigator.onLine);
      if (failure.kind === "conflict") toast.info("This request was already decided");
      else setRefusal(failure);
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <li className="hm-request-row" data-unreadable="" aria-label={UNREADABLE_TITLE}>
      <div className="hm-request-details">
        <h3 className="hm-request-name">{UNREADABLE_TITLE}</h3>
        <p className="hm-request-muted">
          It may be damaged or in a form this app doesn't understand, so nothing from it can be
          shared.
        </p>
        {refusal && (
          <p role="alert" className="hm-request-error">
            {refusal.message}
          </p>
        )}
      </div>
      {(!refusal || refusal.retry) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={saving} aria-busy={saving || undefined}>
              Deny
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deny this request?</AlertDialogTitle>
              <AlertDialogDescription>
                Whoever sent it won't get access to your data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => void deny()}>Deny</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

export function RequestsPage() {
  const requests = useRequests();
  const [tab, setTab] = useState("pending");
  const [reviewing, setReviewing] = useState<ReadableRequest>();
  const trigger = useRef<HTMLElement | null>(null);
  const waiting = requests.pending.length + requests.unreadable.length;
  const list = (entries: readonly ReadableRequest[], pending: boolean) =>
    requests.status === "loading" ? (
      <LoadingSkeleton preset="list" count={3} label="Loading requests" />
    ) : requests.status === "error" ? (
      <ErrorState error="unreachable" actions={{ retry: () => void requests.refresh() }} />
    ) : entries.length || (pending && requests.unreadable.length) ? (
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
        {pending &&
          requests.unreadable.map((entry) => (
            <UnreadableRow
              key={entry.id}
              entry={entry}
              onDeny={(next) => requests.decide(next, { approve: false })}
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
        <h1>Requests</h1>
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
        <TabsContent value="pending">{list(requests.pending, true)}</TabsContent>
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
