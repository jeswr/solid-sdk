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
  isActiveGrant,
  placesText,
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

function Recipient({ entry }: { entry: HistoryEntry }) {
  const name = recipientLabel(entry);
  return (
    <div className="hm-request-who">
      <Avatar aria-hidden="true">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <h3 className="hm-request-name">{name}</h3>
    </div>
  );
}

export function ActiveGrantRow({
  entry,
  storage,
  onRevoke,
}: {
  entry: ActiveHistoryEntry;
  storage: string;
  onRevoke: (entry: ActiveHistoryEntry) => Promise<void>;
}) {
  const name = recipientLabel(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  const revoke = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onRevoke(entry);
      toast.success(`${name} no longer has this access.`);
    } catch (caught) {
      if (caught instanceof HistoryChangedError) setError(caught.message);
      else {
        if (!(caught instanceof HistoryRevokeError))
          console.error("Revoking access failed", caught);
        setError(caught instanceof HistoryRevokeError ? PARTIAL_REVOKE : REVOKE_FAILED);
      }
    } finally {
      // A refresh that failed after a successful revoke must not leave the button stuck.
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <li className="hm-request-row" aria-label={`Access shared with ${name}`}>
      <Recipient entry={entry} />
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
              {name} will no longer be able to use the {placesText(entry.grant.targets.length)}{" "}
              listed. If {name} already had the same access to one of those places before you
              approved, that ends too.
            </AlertDialogDescription>
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

export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const name = recipientLabel(entry);
  return (
    <li className="hm-request-row" aria-label={`${statusText(entry.status)}: ${name}`}>
      <Recipient entry={entry} />
      <div className="hm-request-details">
        <p className="hm-request-types">{statusText(entry.status)}</p>
        {entry.purpose && <p>{entry.purpose.label}</p>}
        <p className="hm-request-muted">
          {permissionDate(entry.decidedAt)}
          {entry.grant && ` · ${placesText(entry.grant.targets.length)}`}
          {entry.revokedAt && ` · Removed ${permissionDate(entry.revokedAt)}`}
        </p>
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
              <HistoryRow key={entry.receipt} entry={entry} />
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
