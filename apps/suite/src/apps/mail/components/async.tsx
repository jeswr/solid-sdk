// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState, LoadingSkeleton, renderAsync } from "@jeswr/suite-ui";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { AppHeading } from "@/shell/app-frame";
import { mailErrorMessage } from "../lib/client";
import { MailError } from "../lib/model";
import { SearchQueryError } from "../lib/search";
import type { AsyncMail } from "../state/mail-context";
export function MailAsync<T>({
  state,
  children,
}: {
  state: AsyncMail<T>;
  children: (data: T) => ReactNode;
}) {
  return renderAsync({
    loading: !state.data && state.status === "loading" && <LoadingSkeleton preset="list" />,
    error:
      state.status === "error" &&
      (state.error instanceof SearchQueryError ? (
        <div className="mail-query-error" role="alert">
          <p>{mailErrorMessage(state.error)}</p>
          <p>Edit your search above and try again.</p>
        </div>
      ) : (
        <ErrorState
          error={
            state.error instanceof MailError && state.error.code === "forbidden"
              ? "forbidden"
              : state.error instanceof MailError && state.error.code === "not-found"
                ? "not-found"
                : "unreachable"
          }
          actions={{ retry: state.retry, goToParent: "/mail/inbox" }}
        >
          <p>{mailErrorMessage(state.error)}</p>
        </ErrorState>
      )),
    children: () =>
      state.data ? (
        <>
          {state.status === "loading" && (
            <div className="mail-refreshing" role="progressbar" aria-label="Refreshing mail" />
          )}
          {children(state.data)}
        </>
      ) : null,
  });
}
export function MissingFolder() {
  return (
    <div className="mail-page">
      <AppHeading>This folder doesn't exist</AppHeading>
      <ErrorState error="not-found" actions={{ goToParent: "/mail/inbox" }}>
        <a href="/mail/inbox">Go to Inbox</a>
      </ErrorState>
    </div>
  );
}

/** Mail empty states sit immediately below the page's h1. */
export function MailEmptyState({
  title,
  body,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  body: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="suite-async-state mail-empty" role="status">
      <span className="suite-async-tile" aria-hidden="true">
        <Mail size={24} strokeWidth={1.5} />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {(primaryAction || secondaryAction) && (
        <div className="suite-async-actions">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
