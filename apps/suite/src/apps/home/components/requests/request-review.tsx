// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * Review one access request (03-home-permissions §2.5): the ConsentSheet content as a Dialog, so
 * the notifications tray can mount the same component. Built from the suite-ui sharing pieces
 * because the packaged ConsentSheet can't show the decision's own error message or leave out
 * counts the Home model doesn't know.
 */

import type { RequestDecision } from "@jeswr/pod-access/requests-solid";
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
  recordedMessage,
  requestCards,
  requesterHost,
  requesterName,
  reviewError,
  selectedDataTypes,
} from "../../lib/requests/model";
import { useCardSummaries, useRequestCaps, useRequests } from "../../state/requests";

export const EXPIRY_UNAVAILABLE = "Expiring access isn't available on this storage";
/** Shown once an approval failed: it may already be pinned, so its choices can't change. */
export const FROZEN_NOTE =
  "Approving may have already started, so these choices stay as you sent them.";
export const FROZEN_DURATION = "Kept as you sent it";
/** The request's own status claims an approval; the requester could have written that. */
export const FINISHING_TEXT = "This request says an approval was started. Finish it, or deny it.";
/** FINISHING_TEXT once denying was refused for good: finishing is all that is left. */
export const FINISHING_ONLY_TEXT = "This request says an approval was started. Finish it.";
const RECORDED =
  "Approving this request already started with choices recorded then. Finish approving applies those recorded choices, which may differ from what you picked here";
/**
 * An approval is pinned that this sheet didn't send (or can't show): finishing applies the choices
 * recorded when it started. This sheet doesn't show them as cards (listed entries carry them as
 * `recorded`, and the finished approval's result reports them for the toast).
 */
export const RECORDED_TEXT = `${RECORDED}, or deny it.`;
/** RECORDED_TEXT once denying was refused for good. */
export const RECORDED_ONLY_TEXT = `${RECORDED}.`;

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

/**
 * share: the editable choices; retry: the frozen payload again; finish: the pinned approval, sent
 * as the frozen payload when that is what this sheet pinned, else with no choices at all.
 */
type Attempt = "share" | "retry" | "finish" | "deny";

interface FrozenApproval {
  /** The exact approval that failed; Try again resends it unchanged. */
  decision: { approve: true; dataTypes: string[]; expiresAt?: Date };
  /** The card ids it was built from, for the success message. */
  selected: string[];
  /** Whether resending it can succeed: its own last failure's, never a later denial's. */
  retry: boolean;
}

/**
 * Whose choices a pinned approval holds. "frozen": possibly this sheet's own failed approval, so
 * finishing resends that exact payload (the SDK refuses it if the pin differs). "recorded": choices
 * this sheet can't know, so finishing sends none and the cards are hidden.
 */
type PinnedChoices = "frozen" | "recorded";

type ShownError = Extract<ReviewError, { kind: "error" }> & { attempt: Attempt };

function DenyButton({
  name,
  label,
  prominent = false,
  disabled,
  onDeny,
}: {
  name: string;
  label: string;
  prominent?: boolean;
  disabled: boolean;
  onDeny: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={prominent ? "default" : "outline"} disabled={disabled}>
          {label}
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
          <AlertDialogAction onClick={onDeny}>Deny</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RequestReview({ entry, onDone }: RequestReviewProps) {
  const requests = useRequests();
  const caps = useRequestCaps();
  const name = requesterName(entry);
  const host = requesterHost(entry);
  // The request claims an interrupted approval: resume whatever the owner's records pinned.
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
  const [error, setError] = useState<ShownError>();
  // After any failed approval the decision may already be pinned: its choices never change again.
  const [frozen, setFrozen] = useState<FrozenApproval>();
  // The SDK reported an approval already pinned: only finishing it can succeed.
  const [pinned, setPinned] = useState<PinnedChoices>();
  // Finishing was refused for good (e.g. the request was denied): it can't be offered again.
  const [finishRefused, setFinishRefused] = useState(false);
  // The SDK refused approving outright (a claimed approval with no record): only Deny is left.
  const [denyOnly, setDenyOnly] = useState(false);
  // Denying was refused for good (e.g. approving already started): Deny isn't offered again.
  const [denyRefused, setDenyRefused] = useState(false);
  const done = useRef(false);
  // One decision at a time, even for clicks that land before the disabled state renders.
  const busy = useRef(false);
  const allId = useId();

  const shareable = cards.filter(isShareable);
  const expiresAt = caps.grantExpiry && !finishing ? expiresAtFor(duration, new Date()) : undefined;
  const finish = (outcome: ReviewOutcome) => {
    if (done.current) return;
    done.current = true;
    onDone(outcome);
  };
  const run = async (attempt: Attempt) => {
    if (busy.current) return;
    let approval: FrozenApproval | undefined;
    if (attempt === "retry" || (attempt === "finish" && pinned === "frozen")) approval = frozen;
    else if (attempt === "share") {
      const sentExpiry = expiresAt ?? undefined;
      approval = {
        decision: {
          approve: true,
          dataTypes: selectedDataTypes(cards, selected),
          ...(sentExpiry ? { expiresAt: sentExpiry } : {}),
        },
        selected: [...selected],
        retry: true,
      };
    }
    if (attempt === "retry" && !approval) return;
    // A choice-less finish resumes the pinned decision exactly as it was recorded; the frozen
    // choices are accepted only if they match the pin, so what the cards show is what is applied.
    const decision: RequestDecision =
      attempt === "deny" ? { approve: false } : approval ? approval.decision : { approve: true };
    busy.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const result = await requests.decide(entry, decision);
      // An approval reports the choices it recorded, which another tab may have made: word the
      // message from those, not from what this sheet sent.
      const recorded = attempt === "deny" ? undefined : result.recorded;
      let message =
        attempt === "deny"
          ? deniedMessage(name, result.notified)
          : recorded
            ? recordedMessage(name, cards, recorded, result.notified)
            : approval
              ? approvedMessage(name, cards, approval.selected, result.notified)
              : finishedMessage(name, result.notified);
      // Without recorded choices, a choice-less finish can't know whether they had an end date:
      // say it whenever the result doesn't promise to enforce one.
      const endDate = recorded
        ? recorded.expiresAt !== undefined
        : approval
          ? approval.decision.expiresAt !== undefined
          : attempt === "finish";
      if (endDate && !result.expiryEnforced) message = `${message} ${EXPIRY_NOT_ENFORCED}`;
      toast.success(message);
      finish(attempt === "deny" ? "denied" : "approved");
    } catch (caught) {
      const failure = reviewError(caught, attempt !== "deny", navigator.onLine);
      if (failure.kind === "conflict") {
        toast.info("This request was already decided");
        finish("already-decided");
        return;
      }
      if (approval) setFrozen({ ...approval, retry: failure.retry });
      // A pin refused while sending choices holds other choices. A refused denial may have hit
      // this sheet's own frozen approval, if it could have pinned; finishing then resends it.
      if (failure.finish) setPinned(attempt === "deny" && frozen?.retry ? "frozen" : "recorded");
      else if (attempt === "finish" && !failure.retry) setFinishRefused(true);
      if (attempt === "deny" && !failure.retry) setDenyRefused(true);
      if (failure.deny) setDenyOnly(true);
      setError({ ...failure, attempt });
      busy.current = false;
      setSaving(false);
    }
  };

  const chosen = selected.filter((id) => shareable.some((card) => card.id === id));
  const allChecked = shareable.length > 0 && chosen.length === shareable.length;
  // The pinned choices aren't known here: show no cards, as for an interrupted approval.
  const unknownChoices = finishing || pinned === "recorded";
  // The choices can't change once an approval failed or is known to be pinned.
  const fixed = frozen !== undefined || pinned !== undefined;
  const locked = saving || fixed;
  const durationProps = !caps.grantExpiry
    ? { disabled: true as const, reason: EXPIRY_UNAVAILABLE }
    : fixed
      ? { disabled: true as const, reason: FROZEN_DURATION }
      : {};
  // Only a failed denial is retried from the error; approvals answer from the footer.
  const retryDenial = error?.attempt === "deny" && error.retry ? () => void run("deny") : undefined;
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
              ? denyRefused
                ? FINISHING_ONLY_TEXT
                : FINISHING_TEXT
              : pinned === "recorded"
                ? denyRefused
                  ? RECORDED_ONLY_TEXT
                  : RECORDED_TEXT
                : "Choose what to share. You can revoke access at any time."}
          </DialogDescription>
          {host && host !== name && <p className="hm-request-muted">Request from {host}</p>}
        </DialogHeader>
        {!unknownChoices && (
          <>
            {fixed && <p className="hm-request-muted">{FROZEN_NOTE}</p>}
            <div className="hm-request-check hm-request-all">
              <Checkbox
                id={allId}
                checked={allChecked ? true : chosen.length ? "indeterminate" : false}
                disabled={locked || shareable.length === 0}
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
                  disabled={locked}
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
            actions={error.category === "unreachable" && retryDenial ? { retry: retryDenial } : {}}
          >
            <p className="hm-request-error">{error.message}</p>
            {retryDenial && error.category !== "unreachable" && (
              <Button variant="outline" disabled={saving} onClick={retryDenial}>
                Retry
              </Button>
            )}
          </ErrorState>
        )}
        <DialogFooter className="hm-request-actions" data-equal-weight="">
          {!finishing && !fixed ? (
            <>
              <DenyButton
                name={name}
                label="Cancel"
                disabled={saving || denyRefused}
                onDeny={() => void run("deny")}
              />
              <Button
                variant="outline"
                disabled={
                  saving || selectedDataTypes(cards, selected).length === 0 || expiresAt === null
                }
                aria-busy={saving || undefined}
                onClick={() => void run("share")}
              >
                Share
              </Button>
            </>
          ) : (
            <>
              {finishing && (
                <Button variant="outline" disabled={saving} onClick={() => finish("dismissed")}>
                  Not now
                </Button>
              )}
              <DenyButton
                name={name}
                label="Deny"
                prominent={denyOnly}
                disabled={saving || denyRefused}
                onDeny={() => void run("deny")}
              />
              {denyOnly ? null : finishing || pinned ? (
                <Button
                  variant="outline"
                  disabled={saving || finishRefused}
                  aria-busy={saving || undefined}
                  onClick={() => void run("finish")}
                >
                  Finish approving
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={saving || frozen?.retry === false}
                  aria-busy={saving || undefined}
                  onClick={() => void run("retry")}
                >
                  Try again
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
