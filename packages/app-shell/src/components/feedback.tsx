// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// FeedbackButton / FeedbackDialog — the suite's shared "report issue / give
// feedback / request help" control. Every Solid suite app (and every future
// `create-solid-app` scaffold) drops this in once and inherits ONE consistent
// way to file an issue against THAT APP's OWN repo.
//
// DECOUPLED BY DESIGN (same as AccountMenu): everything is a prop. The host
// passes its own `repo` (e.g. "jeswr/pod-mail"), `appName`, build `appVersion`,
// and the signed-in `webId`. There is no app-specific session/router coupling.
//
// TWO MECHANISMS (graceful degradation):
//   1. A `submit` hook (the future "feedback proxy") — creates the issue
//      SERVER-SIDE so the reporter needs NO GitHub account. On success we show
//      the returned issue link.
//   2. ELSE (default, zero-infra) — open GitHub's prefilled new-issue page in a
//      new tab (`window.open`). The reporter (who has a GitHub account) submits.
//
// PRIVACY: the WebID is attached ONLY when the reporter ticks the consent box
// (default OFF). Basic diagnostics (app name + version + current page URL + UA)
// are always attached and disclosed in the dialog. Never include tokens/secrets.

import { Bug, HelpCircle, Lightbulb, MessageSquarePlus } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  type FeedbackCategory,
  type FeedbackDiagnostics,
  type FeedbackPayload,
  type FeedbackSubmitResult,
  feedbackLabels,
} from "../lib/feedback-core.js";
import { Button, type ButtonProps } from "./primitives.js";

// ── Presentation data ──────────────────────────────────────────────────────────

/** Per-category presentation (drives the dialog's category selector cards). */
const CATEGORIES: ReadonlyArray<{
  value: FeedbackCategory;
  label: string;
  emoji: string;
  icon: typeof Bug;
}> = [
  { value: "bug", label: "Bug", emoji: "🐛", icon: Bug },
  { value: "feedback", label: "Feedback", emoji: "💡", icon: Lightbulb },
  { value: "help", label: "Help", emoji: "❓", icon: HelpCircle },
];

/**
 * The list of ACTUALLY tabbable elements inside `root`, in DOM order, mirroring
 * the browser's real Tab sequence. `selector` matches focusable candidates
 * (already excluding disabled / `tabindex=-1`); the one nuance the raw selector
 * misses is the **radio group**: native tab order visits only ONE radio per
 * named group — the CHECKED radio, or the FIRST radio if none in the group is
 * checked — never every radio. We therefore drop the non-tabbable members of
 * each radio group. PURE (DOM in, array out) + exported for unit tests.
 *
 * Radios without a `name` are NOT grouped (each is its own control), matching
 * the platform. Radios in a `<form>` group by (form, name); loose radios group
 * by name within the document — for a single modal panel, grouping by `name`
 * alone is the correct, sufficient model.
 */
export function tabbableElements(root: HTMLElement, selector: string): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
  // Per radio-group name, find the single member that participates in tab order:
  // the checked radio always wins; otherwise the first-seen (DOM order) radio.
  const groupTabbable = new Map<string, HTMLElement>();
  for (const el of candidates) {
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const existing = groupTabbable.get(el.name);
      if (existing === undefined || el.checked) groupTabbable.set(el.name, el);
    }
  }
  return candidates.filter((el) => {
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      return groupTabbable.get(el.name) === el;
    }
    return true;
  });
}

// ── FeedbackDialog ──────────────────────────────────────────────────────────────

export interface FeedbackDialogProps {
  /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
  repo: string;
  /** This app's human name, attached to diagnostics + used in the dialog copy. */
  appName: string;
  /** Optional build SHA / version, attached to diagnostics. */
  appVersion?: string;
  /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
  webId?: string | null;
  /**
   * Optional proxy hook. When provided it is called instead of the prefill flow;
   * it should create the issue server-side and resolve with its URL + number.
   */
  submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;
  /** Controls dialog visibility. */
  open: boolean;
  /** Called when the dialog requests to close (backdrop / Escape / Close). */
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "submitting" | "success" | "error";

/**
 * The feedback modal: category selector, description, an optional WebID-consent
 * checkbox (default OFF), a diagnostics note, and submit. Self-contained (no
 * Radix Dialog dependency) — a focus-trapped, Escape-closable overlay built on
 * the suite's token classes so it themes with the rest of the shell.
 */
export function FeedbackDialog({
  repo,
  appName,
  appVersion,
  webId,
  submit,
  open,
  onOpenChange,
}: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [description, setDescription] = useState("");
  const [includeWebId, setIncludeWebId] = useState(false); // PRIVACY: default OFF.
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const titleId = useId();
  const descId = useId();
  const consentId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset to a clean slate each time the dialog opens (the state setters are
  // stable, so `open` is the only dependency).
  useEffect(() => {
    if (open) {
      setCategory("bug");
      setDescription("");
      setIncludeWebId(false);
      setPhase("idle");
      setResult(null);
      setErrorMessage(null);
    }
  }, [open]);

  // Modal focus management: while open, (1) move focus into the dialog, (2) trap
  // Tab/Shift+Tab within it so keyboard users cannot reach the background page
  // (which `aria-modal="true"` promises), and (3) restore focus to the previously
  // focused element (the trigger) on close. Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = (
      typeof document !== "undefined" ? document.activeElement : null
    ) as HTMLElement | null;

    // Focus the description after the dialog has mounted.
    const focusTimer = setTimeout(() => textareaRef.current?.focus(), 0);

    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      // The selector already excludes disabled controls and tabindex=-1 (the
      // backdrop), which is the full set of non-tabbable cases the panel has —
      // so no layout-based visibility filter is needed (and none would work
      // under jsdom, which does no layout). `sr-only` radios stay tabbable.
      //
      // BUT a radio GROUP is special: native browser tab order includes only ONE
      // member per group — the CHECKED radio (or the first radio if none is
      // checked) — never every radio. If we treated all three category radios as
      // tabbable, selecting a non-default category (Feedback/Help) would make the
      // checked radio differ from `first`, so Shift+Tab from it would NOT wrap and
      // focus would escape the modal. Collapse each radio group to its single
      // tabbable member to mirror the browser's real tab order.
      const focusable = tabbableElements(dialog, focusableSelector);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing focusable in the panel — keep focus on the dialog itself.
        e.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      // Wrap focus, and pull focus back in if it has escaped the dialog.
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever was focused before the dialog opened.
      previouslyFocused?.focus?.();
    };
  }, [open, onOpenChange]);

  const buildPayload = useCallback((): FeedbackPayload => {
    const diagnostics: FeedbackDiagnostics = {
      appName,
      appVersion,
      pageUrl: typeof location !== "undefined" ? location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      // PRIVACY: only attach the WebID when the reporter consented.
      webId: includeWebId && webId ? webId : undefined,
    };
    const title = composeIssueTitle(category, description);
    const body = composeIssueBody(description, diagnostics);
    return {
      repo,
      category,
      title,
      body,
      labels: feedbackLabels(category),
      description,
      diagnostics,
    };
  }, [appName, appVersion, webId, includeWebId, category, description, repo]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!description.trim()) return;
      const payload = buildPayload();

      if (submit) {
        // MECHANISM 1: the proxy hook creates the issue server-side.
        setPhase("submitting");
        setErrorMessage(null);
        try {
          const res = await submit(payload);
          setResult(res);
          setPhase("success");
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : "Could not submit feedback.");
          setPhase("error");
        }
        return;
      }

      // MECHANISM 2 (default, zero-infra): open GitHub's prefilled new-issue page.
      const url = buildIssueUrl({
        repo: payload.repo,
        title: payload.title,
        body: payload.body,
        labels: payload.labels,
      });
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      onOpenChange(false);
    },
    [description, buildPayload, submit, onOpenChange],
  );

  if (!open) return null;

  const versionLabel = appVersion ? ` ${appVersion}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop: a real button so the close-on-click affordance is accessible
          (keyboard-activatable, named) rather than a click handler on a div. */}
      <button
        type="button"
        aria-label="Close feedback dialog"
        tabIndex={-1}
        data-app-shell-control="backdrop"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-as-border bg-as-popover p-5 text-as-popover-foreground shadow-md outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {phase === "success" ? "Thanks for the feedback" : `Feedback on ${appName}`}
        </h2>

        {phase === "success" && result ? (
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p>
              Thanks — tracked as{" "}
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                #{result.number}
              </a>
              .
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form className="mt-3 flex flex-col gap-4" onSubmit={handleSubmit}>
            {/* Category selector — native radios styled as cards (accessible by
                default: real radiogroup semantics, keyboard arrow nav, labels). */}
            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-sm font-medium">What is this about?</legend>
              <div className="flex gap-2">
                {CATEGORIES.map(({ value, label, emoji, icon: Icon }) => {
                  const selected = category === value;
                  const id = `${descId}-cat-${value}`;
                  return (
                    <label
                      key={value}
                      htmlFor={id}
                      data-app-shell-control="card"
                      data-selected={selected ? "" : undefined}
                      className={[
                        "flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-md border px-2 py-2 text-sm",
                        "transition-colors focus-within:ring-2 focus-within:ring-as-ring",
                        selected
                          ? "border-as-ring bg-as-accent text-as-accent-foreground"
                          : "border-as-border hover:bg-as-accent hover:text-as-accent-foreground",
                      ].join(" ")}
                    >
                      <input
                        id={id}
                        type="radio"
                        name={`${descId}-category`}
                        value={value}
                        checked={selected}
                        onChange={() => setCategory(value)}
                        data-app-shell-control=""
                        className="sr-only"
                      />
                      <Icon className="size-4" aria-hidden="true" />
                      <span>
                        <span aria-hidden="true">{emoji}</span> {label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={descId} className="text-sm font-medium">
                Tell us more
              </label>
              <textarea
                id={descId}
                ref={textareaRef}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Describe the bug, idea, or question…"
                data-app-shell-control=""
                className="resize-y rounded-md border border-as-border bg-as-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-as-ring"
              />
            </div>

            {/* WebID consent — DEFAULT OFF (privacy) */}
            {webId ? (
              <label htmlFor={consentId} className="flex items-start gap-2 text-sm">
                <input
                  id={consentId}
                  type="checkbox"
                  checked={includeWebId}
                  onChange={(e) => setIncludeWebId(e.target.checked)}
                  data-app-shell-control=""
                  className="mt-0.5"
                />
                <span>Include my WebID so the maintainer can follow up</span>
              </label>
            ) : null}

            {/* Diagnostics disclosure */}
            <p className="text-xs text-as-muted-foreground">
              We attach basic diagnostics: app name + version ({appName}
              {versionLabel}) and the current page URL.
            </p>

            {phase === "error" && errorMessage ? (
              <p role="alert" className="text-sm text-as-destructive">
                {errorMessage}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={phase === "submitting"}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                type="submit"
                disabled={!description.trim() || phase === "submitting"}
              >
                {phase === "submitting"
                  ? "Sending…"
                  : submit
                    ? "Send feedback"
                    : "Open issue on GitHub"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── FeedbackButton ───────────────────────────────────────────────────────────────

export interface FeedbackButtonProps {
  /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
  repo: string;
  /** This app's human name, attached to diagnostics + used in the dialog copy. */
  appName: string;
  /** Optional build SHA / version, attached to diagnostics. */
  appVersion?: string;
  /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
  webId?: string | null;
  /** Optional proxy hook (see FeedbackDialog) — create the issue server-side. */
  submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;
  /** The trigger Button variant (default "ghost"). */
  triggerVariant?: ButtonProps["variant"];
  /** Extra classes for the trigger, for placement. */
  className?: string;
  /** Trigger label (default "Feedback"). */
  label?: string;
}

/**
 * The header-level "Feedback" trigger. Renders a button (icon + label) that
 * opens the FeedbackDialog. Pass your OWN `repo`. Everything else is optional.
 */
export function FeedbackButton({
  repo,
  appName,
  appVersion,
  webId,
  submit,
  triggerVariant = "ghost",
  className,
  label = "Feedback",
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={triggerVariant}
        className={className}
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        <MessageSquarePlus className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
      <FeedbackDialog
        repo={repo}
        appName={appName}
        appVersion={appVersion}
        webId={webId}
        submit={submit}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
