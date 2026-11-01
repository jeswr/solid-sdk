// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Review one access request (03-home-permissions §2.5): the ConsentSheet content as a Dialog, so
 * the notifications tray can mount the same component. Built from the suite-ui sharing pieces
 * because the packaged ConsentSheet can't show the decision's own error message or leave out
 * counts the Home model doesn't know.
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
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DurationChips,
  ErrorState,
  ProvenanceBadge,
  type SharingDuration,
  toast,
} from "@jeswr/suite-ui";
import { useId, useMemo, useRef, useState } from "react";
import { useAccounts } from "@/shell/session/accounts-provider";
import { type DurationSelection, expiresAtFor, initialDuration } from "../../lib/requests/duration";
import {
  accessText,
  approvedMessage,
  deniedMessage,
  headline,
  type ReadableRequest,
  type RequestCard,
  type ReviewError,
  requestCards,
  requesterHost,
  requesterName,
  reviewError,
  selectedDataTypes,
} from "../../lib/requests/model";
import { useCardSummaries, useRequestCaps, useRequests } from "../../state/requests";

export const EXPIRY_UNAVAILABLE = "Expiring access isn't available on this storage";

export type ReviewOutcome = "approved" | "denied" | "already-decided" | "dismissed";

export interface RequestReviewProps {
  entry: ReadableRequest;
  /** Called once the sheet closes: after a decision, a lost race, or a dismissal. */
  onDone: (outcome: ReviewOutcome) => void;
}

function CardItem({
  card,
  checked,
  disabled,
  onChange,
  count,
  sources,
}: {
  card: RequestCard;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  count?: number | undefined;
  sources: readonly string[];
}) {
  const id = useId();
  return (
    <li className="hm-request-card">
      <div className="hm-request-check">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-about`}
          onCheckedChange={(value) => onChange(value === true)}
        />
        <label htmlFor={id}>{card.label}</label>
      </div>
      <div className="hm-request-card-about" id={`${id}-about`}>
        <p>{card.description}</p>
        <p>
          {accessText(card.modes)}
          {count !== undefined && ` · ${count} ${count === 1 ? "item" : "items"}`}
        </p>
      </div>
      {sources.length > 0 && (
        <div className="hm-request-sources">
          {sources.map((source) => (
            <ProvenanceBadge key={source} source={source} />
          ))}
        </div>
      )}
    </li>
  );
}

function AccountChoice({ disabled }: { disabled: boolean }) {
  const id = useId();
  const { accounts, active, switchTo } = useAccounts();
  if (accounts.length <= 1) return null;
  return (
    <div className="hm-request-account">
      <label htmlFor={id}>Change account</label>
      <select
        id={id}
        value={active?.id ?? ""}
        disabled={disabled}
        onChange={(event) => switchTo(event.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name || account.webId}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RequestReview({ entry, onDone }: RequestReviewProps) {
  const requests = useRequests();
  const caps = useRequestCaps();
  const name = requesterName(entry);
  const host = requesterHost(entry);
  const cards = useMemo(() => requestCards(entry), [entry]);
  const summaries = useCardSummaries(cards);
  const [selected, setSelected] = useState<string[]>(() => cards.map((card) => card.id));
  const [duration, setDuration] = useState<DurationSelection>(() =>
    caps.grantExpiry
      ? initialDuration(entry, new Date())
      : { value: "until-revoked", customDate: "" },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Extract<ReviewError, { kind: "error" }>>();
  const done = useRef(false);
  const allId = useId();

  const expiresAt = caps.grantExpiry ? expiresAtFor(duration, new Date()) : undefined;
  const finish = (outcome: ReviewOutcome) => {
    if (done.current) return;
    done.current = true;
    onDone(outcome);
  };
  const run = async (approve: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await requests.decide(
        entry,
        approve
          ? {
              approve: true,
              dataTypes: selectedDataTypes(cards, selected),
              ...(expiresAt ? { expiresAt } : {}),
            }
          : { approve: false },
      );
      if (approve) toast.success(approvedMessage(name, cards, selected, result.notified));
      else toast.success(deniedMessage(name, result.notified));
      finish(approve ? "approved" : "denied");
    } catch (caught) {
      const failure = reviewError(caught, approve, navigator.onLine);
      if (failure.kind === "conflict") {
        toast.info("This request was already decided");
        finish("already-decided");
        return;
      }
      setError(failure);
      setSaving(false);
    }
  };

  const allChecked = selected.length === cards.length;
  const durationProps = caps.grantExpiry
    ? {}
    : { disabled: true as const, reason: EXPIRY_UNAVAILABLE };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) finish("dismissed");
      }}
    >
      <DialogContent
        className="hm-request-sheet"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{headline(name, entry.purpose)}</DialogTitle>
          <DialogDescription>
            Choose what to share. You can revoke access at any time.
          </DialogDescription>
          {host && host !== name && <p className="hm-request-muted">Request from {host}</p>}
        </DialogHeader>
        <div className="hm-request-check hm-request-all">
          <Checkbox
            id={allId}
            checked={allChecked ? true : selected.length ? "indeterminate" : false}
            disabled={saving}
            onCheckedChange={(value) =>
              setSelected(value === true ? cards.map((card) => card.id) : [])
            }
          />
          <label htmlFor={allId}>Select all</label>
        </div>
        <ul className="hm-request-cards" aria-label="Data requested">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              checked={selected.includes(card.id)}
              disabled={saving}
              count={summaries[card.id]?.count}
              sources={summaries[card.id]?.sources ?? []}
              onChange={(checked) =>
                setSelected((current) =>
                  checked
                    ? [...current.filter((id) => id !== card.id), card.id]
                    : current.filter((id) => id !== card.id),
                )
              }
            />
          ))}
        </ul>
        <DurationChips
          value={duration.value}
          onChange={(value: SharingDuration) => setDuration((current) => ({ ...current, value }))}
          customDate={duration.customDate}
          onCustomDateChange={(customDate) =>
            setDuration((current) => ({ ...current, customDate }))
          }
          {...durationProps}
        />
        <AccountChoice disabled={saving} />
        {error && (
          <ErrorState
            key={error.message}
            error={error.category}
            actions={error.category === "unreachable" ? { retry: () => setError(undefined) } : {}}
          >
            <p className="hm-request-error">{error.message}</p>
          </ErrorState>
        )}
        <DialogFooter className="hm-request-actions" data-equal-weight="">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={saving}>
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deny this request?</AlertDialogTitle>
                <AlertDialogDescription>
                  {name} won't get access to your data. You can still share with them later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction onClick={() => void run(false)}>Deny</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            disabled={saving || selected.length === 0 || expiresAt === null}
            aria-busy={saving || undefined}
            onClick={() => void run(true)}
          >
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
