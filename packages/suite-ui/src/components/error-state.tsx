// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { AlertCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  type ErrorAction,
  type ErrorCategory,
  errorActionLabels,
  errorStateCopy,
} from "./async-copy.js";
import { type LoadingPreset, LoadingSkeleton } from "./loading-skeleton.js";

export interface ClassifiedError {
  category: ErrorCategory;
  retryAfterMs?: number | undefined;
}
export type ErrorRecovery = Partial<Record<ErrorAction, (() => void) | string>>;
export interface ErrorStateProps {
  /** Keep the classified object stable for one occurrence; replace it for each new error. */
  error: ErrorCategory | ClassifiedError;
  actions?: ErrorRecovery | undefined;
  accessRequests?: boolean | undefined;
  loadingPreset?: LoadingPreset | undefined;
  /** Session/conflict dialog supplied by the application; raw error details never render. */
  children?: ReactNode;
}

function RetryAction({
  error,
  delay,
  action,
}: {
  error: ErrorStateProps["error"];
  delay: number;
  action: (() => void) | string;
}) {
  const [elapsed, setElapsed] = useState<{ error: typeof error; delay: number }>();
  const waiting = delay > 0 && (elapsed?.error !== error || elapsed.delay !== delay);
  useEffect(() => {
    if (!(delay > 0)) return;
    // Chunk long Retry-After values instead of overflowing the browser's 32-bit timeout.
    const deadline = Date.now() + delay;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) setElapsed({ error, delay });
      else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
    };
    tick();
    return () => clearTimeout(timer);
  }, [delay, error]);
  return <RecoveryAction name="retry" action={action} disabled={waiting} />;
}

function RecoveryAction({
  name,
  action,
  disabled = false,
}: {
  name: ErrorAction;
  action: (() => void) | string;
  disabled?: boolean;
}) {
  if (typeof action === "string" && !disabled) {
    // Use native links for navigation; never expose non-HTTP executable schemes.
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(action)) return null;
    return (
      <a className="suite-async-action" href={action} rel="noopener noreferrer">
        {errorActionLabels[name]}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="suite-async-action"
      disabled={disabled}
      onClick={typeof action === "function" ? action : undefined}
    >
      {errorActionLabels[name]}
    </button>
  );
}

export function ErrorState({
  error,
  actions = {},
  accessRequests = false,
  loadingPreset = "list",
  children,
}: ErrorStateProps) {
  const category = typeof error === "string" ? error : error.category;
  const delay = typeof error === "string" ? 0 : (error.retryAfterMs ?? 0);
  const copy = errorStateCopy[category];
  return (
    <div className="suite-error-state">
      {category === "reauth" && <LoadingSkeleton preset={loadingPreset} />}
      <div className="suite-async-state suite-async-error" role="alert" data-category={category}>
        <span className="suite-async-tile" aria-hidden="true">
          <AlertCircle size={24} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h3>{copy.title}</h3>
        <div className="suite-async-actions">
          {copy.actions.map((name) => {
            const action = actions[name];
            if (!action || (name === "requestAccess" && !accessRequests)) return null;
            return name === "retry" ? (
              <RetryAction
                key={`${category}:${delay}`}
                error={error}
                delay={Number.isFinite(delay) ? Math.max(0, delay) : 0}
                action={action}
              />
            ) : (
              <RecoveryAction key={name} name={name} action={action} />
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
