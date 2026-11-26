// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * `/permissions/history`: requests you answered, from your private access records, with the
 * approvals still in place first so their access can be removed in one step.
 */

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
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useRef, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import {
  type ActiveHistoryEntry,
  HistoryChangedError,
  type HistoryEntry,
  HistoryRevokeError,
  HistoryUnfinishedError,
  IncompleteFolderCheckError,
  isActiveGrant,
  placesText,
  type RevokeOutcome,
  recipientHref,
  recipientLabel,
  statusText,
} from "../../lib/permissions/history";
import { permissionDate, relativePath } from "../../lib/permissions/view";
import { initials, targetRoleText } from "../../lib/requests/model";
import { type HistoryBinding, useAccessHistory } from "../../state/history";
import { useHomeSession } from "../home-app";

export const EMPTY_ACTIVE = "Nothing you approved from a request is still shared.";
export const EMPTY_HISTORY = "No answered requests yet. Requests you approve or deny appear here.";
export const PARTIAL_REVOKE =
  "Some of this access couldn't be removed, so it's still listed. Try again, or remove it from Permissions.";
export const REVOKE_FAILED = "The access couldn't be removed. Try again.";
/** What a removal does and does not do, shown wherever removing is offered. */
export const REVOKE_SCOPE =
  "This removes only the access this approval gave, including copies of it kept on items inside a shared folder. They may still have access to these places another way: through a parent folder, a group, public sharing, or something shared with them directly.";

/** Name up to ten places, then say how many more. */
function placeList(urls: readonly string[], storage: string): string {
  const names = urls.slice(0, 10).map((url) => relativePath(url, storage));
  return urls.length > 10 ? `${names.join(", ")} and ${urls.length - 10} more` : names.join(", ");
}

/** What a partial revoke changed and what it left, without listing a place as both. */
export function partialRevokeText(error: HistoryRevokeError, storage: string): string {
  const unchecked = error.failed
    .filter(({ error: cause }) => cause instanceof IncompleteFolderCheckError)
    .map(({ url }) => url);
  const notRemoved = [
    ...new Set(
      error.failed
        .filter(({ error: cause }) => !(cause instanceof IncompleteFolderCheckError))
        .map(({ url }) => url),
    ),
  ];
  return `${PARTIAL_REVOKE}${notRemoved.length ? ` Not removed: ${placeList(notRemoved, storage)}.` : ""}${
    unchecked.length
      ? ` Not everything inside ${placeList(unchecked, storage)} could be checked; if trying again doesn't help, remove what's left in Permissions.`
      : ""
  }${error.removed.length ? ` Removed: ${placeList(error.removed, storage)}.` : ""}`;
}

/** A WebID is the identity: shown whole, selectable, and wrapped rather than cut off. */
function WebId({ id }: { id: string }) {
  return (
    <code className="hm-request-muted" style={{ overflowWrap: "anywhere", userSelect: "all" }}>
      {id}
    </code>
  );
}

function Recipient({ entry, name }: { entry: HistoryEntry; name: string }) {
  return (
    <div className="hm-request-who">
      <Avatar aria-hidden="true">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div>
        <h3 className="hm-request-name">{name}</h3>
        {entry.recipient && <WebId id={entry.recipient} />}
      </div>
    </div>
  );
}

export function ActiveGrantRow({
  entry,
  storage,
  name: resolved,
  onRevoke,
}: {
  entry: ActiveHistoryEntry;
  storage: string;
  name?: string | undefined;
  onRevoke: (entry: ActiveHistoryEntry) => Promise<RevokeOutcome>;
}) {
  const name = recipientLabel(entry, resolved);
  const href = recipientHref(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  const revoke = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await onRevoke(entry);
      toast.success(
        `Removed the access this approval gave ${name}. ${name} may still have access another way; check Permissions.${
          outcome.alreadyGone.length
            ? ` ${placesText(outcome.alreadyGone.length)} no longer exist, so there was nothing to remove there.`
            : ""
        }${
          outcome.stillHeld.length
            ? ` ${name} still has their own access to ${placesText(outcome.stillHeld.length)} inside: ${placeList(outcome.stillHeld, storage)}. Change it in Permissions.`
            : ""
        }`,
      );
    } catch (caught) {
      if (caught instanceof HistoryChangedError || caught instanceof HistoryUnfinishedError)
        setError(caught.message);
      else {
        if (!(caught instanceof HistoryRevokeError))
          console.error("Revoking access failed", caught);
        setError(
          caught instanceof HistoryRevokeError ? partialRevokeText(caught, storage) : REVOKE_FAILED,
        );
      }
    } finally {
      // A refresh that failed after a successful revoke must not leave the button stuck.
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <li className="hm-request-row" aria-label={`Access shared with ${name}`}>
      <Recipient entry={entry} name={name} />
      <div className="hm-request-details">
        <p className="hm-request-types">
          {targetRoleText(entry.grant.role)} · {placesText(entry.grant.targets.length)}
        </p>
        <ul className="hm-request-targets" aria-label="Places shared">
          {entry.grant.targets.map((url) => (
            <li key={url}>{relativePath(url, storage)}</li>
          ))}
        </ul>
        {entry.purpose && <p>{entry.purpose.label}</p>}
        <p className="hm-request-muted">
          Approved {permissionDate(entry.decidedAt)}
          {entry.expiresAt && ` · Recorded until ${permissionDate(entry.expiresAt)}`}
        </p>
        <p className="hm-request-muted">
          Removing this takes away only what this approval gave.{" "}
          {href && <Link href={href}>See everything {name} can access</Link>}
        </p>
        {error && (
          <p role="alert" className="hm-request-error">
            {error}
          </p>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={busy} aria-busy={busy || undefined}>
            Remove access
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}'s access?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {targetRoleText(entry.grant.role).toLowerCase()} access this approval
              gave {name} on the {placesText(entry.grant.targets.length)} listed. If {name} already
              had the same access to one of those places before you approved, that ends too.{" "}
              {REVOKE_SCOPE}
            </AlertDialogDescription>
            {entry.recipient && (
              <p>
                Account: <WebId id={entry.recipient} />
              </p>
            )}
            {href && <Link href={href}>See everything {name} can access in Permissions</Link>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revoke()}>Remove access</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function HistoryRow({
  entry,
  name: resolved,
}: {
  entry: HistoryEntry;
  name?: string | undefined;
}) {
  const name = recipientLabel(entry, resolved);
  return (
    <li className="hm-request-row" aria-label={`${statusText(entry.status)}: ${name}`}>
      <Recipient entry={entry} name={name} />
      <div className="hm-request-details">
        <p className="hm-request-types">{statusText(entry.status)}</p>
        {entry.purpose && <p>{entry.purpose.label}</p>}
        <p className="hm-request-muted">
          {permissionDate(entry.decidedAt)}
          {entry.grant && ` · ${placesText(entry.grant.targets.length)}`}
          {entry.revokedAt && ` · Removed ${permissionDate(entry.revokedAt)}`}
        </p>
        {entry.status === "approving" && (
          <p className="hm-request-muted">
            Only some of this access may be in place. Finish approving the request from{" "}
            <Link href="/permissions/requests">Requests</Link>, or change access in{" "}
            <Link href="/permissions">Permissions</Link>; you can't remove it from here until then.
          </p>
        )}
      </div>
    </li>
  );
}

export function HistoryLists({ history, storage }: { history: HistoryBinding; storage: string }) {
  if (history.status === "loading")
    return <LoadingSkeleton preset="list" count={3} label="Loading history" />;
  if (history.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: () => void history.refresh() }} />;
  const active = history.entries.filter(isActiveGrant);
  return (
    <>
      <section aria-labelledby="hm-history-active">
        <h2 id="hm-history-active">Still shared</h2>
        {active.length ? (
          <ul className="hm-request-list">
            {active.map((entry) => (
              <ActiveGrantRow
                key={entry.receipt}
                entry={entry}
                storage={storage}
                name={history.names[entry.recipient]}
                onRevoke={history.revoke}
              />
            ))}
          </ul>
        ) : (
          <p className="hm-request-muted">{EMPTY_ACTIVE}</p>
        )}
      </section>
      <section aria-labelledby="hm-history-all">
        <h2 id="hm-history-all">All answers</h2>
        {history.entries.length ? (
          <ul className="hm-request-list">
            {history.entries.map((entry) => (
              <HistoryRow
                key={entry.receipt}
                entry={entry}
                name={entry.recipient ? history.names[entry.recipient] : undefined}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title={EMPTY_HISTORY} body="" />
        )}
      </section>
    </>
  );
}

export function HistoryPage() {
  const history = useAccessHistory();
  const session = useHomeSession();
  return (
    <div className="hm-page hm-requests-page hm-history-page">
      <header>
        <Link className="hm-request-back" href="/permissions">
          Permissions
        </Link>
        <AppHeading>History</AppHeading>
        <p className="hm-request-muted">Requests you answered, from your private access records.</p>
      </header>
      <HistoryLists history={history} storage={session.storageUrl} />
    </div>
  );
}
