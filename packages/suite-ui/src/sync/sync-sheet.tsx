// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useId, useRef } from "react";
import { Button } from "../components/ui/button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useRequiresOnline } from "./capability-gate.js";
import { relativeTime } from "./lib/time.js";
import type { SyncSnapshot } from "./types.js";

export interface SyncSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: SyncSnapshot;
  onRetryAll: () => void;
  onRetry: (id: string) => void;
  onResolve: (conflictId: string) => void;
  locale?: string;
  /** A fixed clock is useful for server rendering and deterministic fixtures. */
  now?: Date;
}
export function SyncSheet({
  open,
  onOpenChange,
  snapshot,
  onRetryAll,
  onRetry,
  onResolve,
  locale,
  now = new Date(),
}: SyncSheetProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const retry = useRequiresOnline(snapshot.online, "retry");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="suite-sync-sheet"
        side="right"
        onOpenAutoFocus={(event) => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle ref={titleRef} tabIndex={-1}>
            Sync status
          </SheetTitle>
          <SheetDescription>
            Changes saved on this device and items that need your decision.
          </SheetDescription>
        </SheetHeader>
        {/* A scroll container: focusable and named so keyboard users can scroll a long
            queue even when it holds no buttons (WCAG 2.1.1). */}
        <section
          className="suite-sync-body"
          aria-label="Sync items"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be keyboard-reachable
          tabIndex={0}
        >
          {snapshot.pending.length === 0 && snapshot.conflicts.length === 0 && (
            <p role="status">Everything is saved</p>
          )}
          {snapshot.pending.length > 0 && (
            <section aria-labelledby={`${id}-waiting`}>
              <h3 id={`${id}-waiting`}>Waiting to sync</h3>
              <ul className="suite-sync-list">
                {snapshot.pending.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}</strong>
                    <span className="suite-sync-note">{item.where}</span>
                    <time dateTime={item.queuedAt.toISOString()} className="suite-sync-note">
                      {relativeTime(item.queuedAt, now, locale)}
                    </time>
                    {item.state === "failed" && (
                      <>
                        <p role="alert" className="suite-sync-error">
                          {item.error ?? "This change could not be synced."}
                        </p>
                        <Button
                          variant="outline"
                          disabled={retry.disabled}
                          aria-label={`Retry ${item.label}`}
                          aria-describedby={retry.disabled ? `${id}-offline` : undefined}
                          onClick={() => onRetry(item.id)}
                        >
                          Retry
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {snapshot.conflicts.length > 0 && (
            <section aria-labelledby={`${id}-conflicts`}>
              <h3 id={`${id}-conflicts`}>Needs your decision</h3>
              <ul className="suite-sync-list">
                {snapshot.conflicts.map((conflict) => (
                  <li key={conflict.id}>
                    <strong>{conflict.name}</strong>
                    <span className="suite-sync-note">{conflict.where}</span>
                    <p>{conflict.summary}</p>
                    <time dateTime={conflict.changedAt.toISOString()} className="suite-sync-note">
                      {relativeTime(conflict.changedAt, now, locale)}
                    </time>
                    <Button
                      variant="outline"
                      aria-label={`Resolve ${conflict.name}`}
                      onClick={() => onResolve(conflict.id)}
                    >
                      Resolve
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
        <SheetFooter>
          {snapshot.pending.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <fieldset
                    className="suite-disabled-trigger"
                    tabIndex={retry.disabled ? 0 : undefined}
                    aria-label={retry.disabled ? retry.reason : undefined}
                  >
                    <Button
                      variant="outline"
                      disabled={retry.disabled}
                      aria-describedby={retry.disabled ? `${id}-offline` : undefined}
                      onClick={onRetryAll}
                    >
                      Retry all
                    </Button>
                  </fieldset>
                </TooltipTrigger>
                {retry.disabled && <TooltipContent>{retry.reason}</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          )}
          {retry.disabled && (
            <p className="suite-sync-note" id={`${id}-offline`}>
              {retry.reason}
            </p>
          )}
          <p className="suite-sync-note">
            {snapshot.lastSyncedAt ? (
              <>
                Last synced{" "}
                <time dateTime={snapshot.lastSyncedAt.toISOString()}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(snapshot.lastSyncedAt)}
                </time>
              </>
            ) : (
              "Not synced yet"
            )}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
