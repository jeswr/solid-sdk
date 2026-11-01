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
import { type DurationSelection, expiresAtFor, initialDuration } from "../../lib/requests/duration";
import {
  ADD_ONLY_TEXT,
  accessText,
  approvedMessage,
  deniedMessage,
  EXPIRY_NOT_ENFORCED,
  finishedMessage,
  headline,
  initialSelection,
  isShareable,
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
  const shareable = isShareable(card);
  return (
    <li className="hm-request-card" data-shareable={shareable || undefined}>
      <div className="hm-request-check">
        <Checkbox
          id={id}
          checked={shareable && checked}
          disabled={disabled || !shareable}
          aria-describedby={`${id}-about`}
          onCheckedChange={(value) => onChange(value === true)}
        />
        <label htmlFor={id}>{card.label}</label>
      </div>
      <div className="hm-request-card-about" id={`${id}-about`}>
        {card.classIri && <p className="hm-request-iri">{card.classIri}</p>}
        <p>{card.description}</p>
        <p>
          {shareable ? accessText(card.modes) : ADD_ONLY_TEXT}
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

/*
 * No "Change account" here: decisions run on Home's own pod session (useHomeSession), not on the
 * active shell account, so switching accounts would not change who answers. Offer it again once
 * useHomeSession follows the active suite account, and then remount the review (key it by the
 * account) whenever the account changes.
 */

export function RequestReview({ entry, onDone }: RequestReviewProps) {
  const requests = useRequests();
  const caps = useRequestCaps();
  const name = requesterName(entry);
  const host = requesterHost(entry);
  // An interrupted approval resumes the choices pinned when it started: nothing here is editable.
  const finishing = entry.status === "approving";
  const cards = useMemo(() => requestCards(entry), [entry]);
  const summaries = useCardSummaries(finishing ? [] : cards);
  const [selected, setSelected] = useState<string[]>(() => initialSelection(cards));
  const [duration, setDuration] = useState<DurationSelection>(() =>
    caps.grantExpiry
      ? initialDuration(entry, new Date())
      : { value: "until-revoked", customDate: "" },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Extract<ReviewError, { kind: "error" }>>();
  const done = useRef(false);
  // One decision at a time, even for clicks that land before the disabled state renders.
  const busy = useRef(false);
  // The last decision tried, for Retry.
  const last = useRef<boolean>(undefined);
  const allId = useId();

  const shareable = cards.filter(isShareable);
  const expiresAt = caps.grantExpiry && !finishing ? expiresAtFor(duration, new Date()) : undefined;
  const finish = (outcome: ReviewOutcome) => {
    if (done.current) return;
    done.current = true;
    onDone(outcome);
  };
  const run = async (approve: boolean) => {
    if (busy.current) return;
    busy.current = true;
    last.current = approve;
    setSaving(true);
    setError(undefined);
    const sentExpiry = approve && !finishing ? (expiresAt ?? undefined) : undefined;
    try {
      const result = await requests.decide(
        entry,
        finishing
          ? // Resume the pinned decision: explicit choices would be refused.
            { approve: true }
          : approve
            ? {
                approve: true,
                dataTypes: selectedDataTypes(cards, selected),
                ...(sentExpiry ? { expiresAt: sentExpiry } : {}),
              }
            : { approve: false },
      );
      let message = finishing
        ? finishedMessage(name, result.notified)
        : approve
          ? approvedMessage(name, cards, selected, result.notified)
          : deniedMessage(name, result.notified);
      if (sentExpiry && !result.expiryEnforced) message = `${message} ${EXPIRY_NOT_ENFORCED}`;
      toast.success(message);
      finish(approve ? "approved" : "denied");
    } catch (caught) {
      const failure = reviewError(caught, approve, navigator.onLine);
      if (failure.kind === "conflict") {
        toast.info("This request was already decided");
        finish("already-decided");
        return;
      }
      setError(failure);
      busy.current = false;
      setSaving(false);
    }
  };
  const retry = () => {
    if (last.current !== undefined) void run(last.current);
  };

  const chosen = selected.filter((id) => shareable.some((card) => card.id === id));
  const allChecked = shareable.length > 0 && chosen.length === shareable.length;
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
            {finishing
              ? `You already chose what to share with ${name}, but approving didn't finish. Finish approving to give them that access.`
              : "Choose what to share. You can revoke access at any time."}
          </DialogDescription>
          {host && host !== name && <p className="hm-request-muted">Request from {host}</p>}
        </DialogHeader>
        {!finishing && (
          <>
            <div className="hm-request-check hm-request-all">
              <Checkbox
                id={allId}
                checked={allChecked ? true : chosen.length ? "indeterminate" : false}
                disabled={saving || shareable.length === 0}
                onCheckedChange={(value) =>
                  setSelected(value === true ? shareable.map((card) => card.id) : [])
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
              onChange={(value: SharingDuration) =>
                setDuration((current) => ({ ...current, value }))
              }
              customDate={duration.customDate}
              onCustomDateChange={(customDate) =>
                setDuration((current) => ({ ...current, customDate }))
              }
              {...durationProps}
            />
          </>
        )}
        {error && (
          <ErrorState
            key={error.message}
            error={error.category}
            actions={error.category === "unreachable" && error.retry ? { retry } : {}}
          >
            <p className="hm-request-error">{error.message}</p>
            {error.retry && error.category !== "unreachable" && (
              <Button variant="outline" disabled={saving} onClick={retry}>
                Retry
              </Button>
            )}
          </ErrorState>
        )}
        <DialogFooter className="hm-request-actions" data-equal-weight="">
          {finishing ? (
            <Button variant="outline" disabled={saving} onClick={() => finish("dismissed")}>
              Not now
            </Button>
          ) : (
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
          )}
          <Button
            variant="outline"
            disabled={
              saving ||
              (!finishing &&
                (selectedDataTypes(cards, selected).length === 0 || expiresAt === null))
            }
            aria-busy={saving || undefined}
            onClick={() => void run(true)}
          >
            {finishing ? "Finish approving" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
