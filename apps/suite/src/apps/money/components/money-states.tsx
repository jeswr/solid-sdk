// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, ErrorState, IconButton, LoadingSkeleton } from "@jeswr/suite-ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import { useMoney } from "../state/money-context";
import type { ReadProblem } from "../state/read-snapshot";

export function MoneyLoading() {
  return <LoadingSkeleton preset="table" label="Loading Money" />;
}

export function MoneyOpening() {
  return (
    <>
      <h1>Opening Money</h1>
      <MoneyLoading />
    </>
  );
}

export function focusMoneyHeading() {
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>(".mon-page h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  });
}

/** Shared by every route, so read failures never turn into first-use empties. */
export function MoneyContent({ children }: { children: ReactNode }) {
  const money = useMoney();
  const path = useRoutePathname();
  const content = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);
  const focusAfterRetry = useRef(false);
  const [dismissed, setDismissed] = useState<{
    problems: ReadProblem[] | undefined;
    error: unknown;
  }>();
  const problems = money.problems;
  const scoped = problems?.find(
    (problem) =>
      path === `/money/${problem.kind}` &&
      !(problem.kind === "rules" && money.rulesProblem === "invalid"),
  );
  const hasData =
    money.accounts.length > 0 ||
    money.transactions.length > 0 ||
    money.categories.length > 0 ||
    money.budgets.length > 0 ||
    money.rules.length > 0;
  const scopedHasData =
    scoped &&
    (scoped.kind === "categories"
      ? money.categories.length
      : scoped.kind === "rules"
        ? money.rules.length
        : scoped.kind === "budgets"
          ? money.budgets.length
          : scoped.kind === "accounts"
            ? money.accounts.length
            : money.transactions.length);
  // Budget's URL is singular; individual month failures remain partial notices.
  const budgetIndex = path === "/money/budget" && money.budgetProblem && !money.budgets.length;
  const failedAccounts =
    !money.accounts.length &&
    problems?.some((problem) => problem.kind === "accounts") &&
    (path === "/money" || path === "/money/accounts" || path.startsWith("/money/a/"));
  const wholeError =
    (money.status === "error" && !hasData) ||
    failedAccounts ||
    (scoped && !scopedHasData) ||
    budgetIndex;
  const failure =
    money.error ??
    problems?.find((problem) => accessDenied(problem.error))?.error ??
    scoped?.error ??
    problems?.[0]?.error;
  const retry = async () => {
    if (retrying) return;
    focusAfterRetry.current = true;
    setRetrying(true);
    await money.refresh();
    setRetrying(false);
  };
  useEffect(() => {
    if (retrying || !focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    const target = content.current?.querySelector<HTMLElement>("h1");
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
  }, [retrying]);
  // Rules owns the conditional reset flow for a corrupt file. Keep that recovery reachable.
  const issueCount =
    problems?.filter(
      (problem) =>
        !(
          path === "/money/rules" &&
          problem.kind === "rules" &&
          money.rulesProblem === "invalid" &&
          !money.rules.length
        ),
    ).length ?? 0;
  return (
    <div ref={content} aria-busy={retrying}>
      {retrying && (
        <p role="status" aria-label="Refreshing Money">
          Refreshing Money…
        </p>
      )}
      {money.status === "loading" ? (
        <>
          <h1>Opening Money</h1>
          <MoneyLoading />
        </>
      ) : wholeError ? (
        <>
          <h1>
            Couldn't open {budgetIndex ? "your budget" : scoped ? `your ${scoped.kind}` : "Money"}
          </h1>
          <ErrorState error="unknown">
            <p>
              We couldn't read{" "}
              {budgetIndex
                ? "your saved budget"
                : scoped
                  ? `your ${scoped.kind}`
                  : "your Money data"}
              . Try again to load it from your pod.
            </p>
            <Button onClick={retry} disabled={retrying}>
              Retry
            </Button>
            <AccessHint error={failure} />
          </ErrorState>
        </>
      ) : (
        <>
          {(money.status === "error" || issueCount > 0) &&
            (dismissed?.problems !== problems ||
              dismissed?.error !== money.error ||
              !dismissed) && (
              <div
                className="mon-rules-warning mon-read-notice"
                role="status"
                aria-label="Money read problems"
              >
                <div className="mon-read-copy">
                  <p>
                    {money.status === "error"
                      ? "Money couldn't be refreshed"
                      : `${issueCount} ${issueCount === 1 ? "item couldn't" : "items couldn't"} be read`}
                  </p>
                  <p>
                    Showing the data we could read, including any last readable copies. Balances and
                    totals may be incomplete.
                  </p>
                  <AccessHint error={failure} />
                </div>
                <Button variant="outline" onClick={retry} disabled={retrying}>
                  Retry
                </Button>
                <IconButton
                  label="Dismiss read problems"
                  variant="ghost"
                  onClick={() => {
                    setDismissed({ problems, error: money.error });
                    focusMoneyHeading();
                  }}
                >
                  <X aria-hidden="true" />
                </IconButton>
              </div>
            )}
          {children}
        </>
      )}
    </div>
  );
}

function accessDenied(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return status === 401 || status === 403;
}

function AccessHint({ error }: { error: unknown }) {
  const accounts = useOptionalAccounts();
  const money = useMoney();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  if (!accessDenied(error)) return null;
  return (
    <>
      <p>Check your sign-in and access to this pod in the account menu, then retry.</p>
      {accounts && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem(false);
            try {
              await accounts.reauth();
              await money.refresh();
              focusMoneyHeading();
            } catch {
              setProblem(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign in
        </Button>
      )}
      {problem && <p role="alert">We couldn't sign you in. Try again from the account menu.</p>}
    </>
  );
}
