// AUTHORED-BY Codex GPT-6.1-Sol
import { File, LockKeyhole, Search, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyVariant =
  | "first-use"
  | "no-results"
  | "filtered-empty"
  | "no-access"
  | "not-available-offline";
export interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string | undefined;
  body?: string | undefined;
  query?: string;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  onClearFilters?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}

export function EmptyState({
  variant = "first-use",
  title,
  body,
  query = "",
  icon,
  primaryAction,
  secondaryAction,
  onClearFilters,
  onRetry,
}: EmptyStateProps) {
  const filtered = variant === "filtered-empty" || variant === "no-results";
  const offline = variant === "not-available-offline";
  const Icon = offline ? WifiOff : variant === "no-access" ? LockKeyhole : filtered ? Search : File;
  const heading =
    title ??
    (filtered
      ? `No results for '${query}'`
      : offline
        ? "Not available offline"
        : variant === "no-access"
          ? "You don't have access to this"
          : "No files yet");
  const description =
    body ??
    (filtered
      ? "Try another search or clear your filters."
      : offline
        ? "Reconnect to load this item."
        : variant === "no-access"
          ? "Request access or switch to another account."
          : "Add a file to get started.");
  const action =
    primaryAction ??
    (filtered && onClearFilters ? (
      <button type="button" className="suite-async-action" onClick={onClearFilters}>
        Clear filters
      </button>
    ) : offline && onRetry ? (
      <button type="button" className="suite-async-action" onClick={onRetry}>
        Retry
      </button>
    ) : null);
  return (
    <div className="suite-async-state" role="status" data-variant={variant}>
      <span className="suite-async-tile" aria-hidden="true">
        {icon ?? <Icon size={24} strokeWidth={1.5} aria-hidden="true" />}
      </span>
      <h3>{heading}</h3>
      <p>{description}</p>
      {(action || secondaryAction) && (
        <div className="suite-async-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
