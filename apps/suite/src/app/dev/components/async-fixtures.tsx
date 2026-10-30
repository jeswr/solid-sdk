// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  EmptyState,
  type EmptyVariant,
  type ErrorCategory,
  type ErrorRecovery,
  ErrorState,
  errorStateCopy,
  type LoadingPreset,
  LoadingSkeleton,
  renderAsync,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import { useState } from "react";

const emptyVariants: EmptyVariant[] = [
  "first-use",
  "no-results",
  "filtered-empty",
  "no-access",
  "not-available-offline",
];
const presets: LoadingPreset[] = ["list", "grid", "document", "detail", "table"];
export type AsyncFixtureKind =
  | "empty-state"
  | "error-state"
  | "loading-skeleton"
  | "toasts"
  | "render-async";

function AsyncExample() {
  const [state, setState] = useState("ready");
  return (
    <section className="fixture-component" data-fixture-state="async-list">
      <h2>List lifecycle</h2>
      <label className="fixture-field">
        Content state
        <select value={state} onChange={(event) => setState(event.target.value)}>
          {[
            "ready",
            "loading",
            "refreshing",
            "empty",
            "filtered-empty",
            "error",
            "offline-cached",
            "offline-uncached",
          ].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      {renderAsync({
        loading: state === "loading" && <LoadingSkeleton preset="list" />,
        error: state === "error" && (
          <ErrorState
            error="unreachable"
            actions={{
              retry: () => setState("ready"),
              showSavedCopies: () => setState("offline-cached"),
            }}
          />
        ),
        empty:
          state === "empty" ? (
            <EmptyState
              primaryAction={
                <button
                  type="button"
                  className="suite-async-action"
                  onClick={() => setState("ready")}
                >
                  Upload a file
                </button>
              }
            />
          ) : state === "filtered-empty" ? (
            <EmptyState
              variant="filtered-empty"
              query="summer"
              onClearFilters={() => setState("ready")}
            />
          ) : state === "offline-uncached" ? (
            <EmptyState variant="not-available-offline" onRetry={() => setState("ready")} />
          ) : null,
        children: (
          <>
            <p role="status">
              {state === "refreshing"
                ? "Refreshing files"
                : state === "offline-cached"
                  ? "Offline — showing saved copies"
                  : "Files are up to date"}
            </p>
            <ul className="density-rows" aria-label="Files">
              <li>Quarterly plan</li>
              <li>Holiday photos</li>
              <li>Q3 budget.xlsx</li>
            </ul>
          </>
        ),
      })}
    </section>
  );
}

export function AsyncFixtures({ kind }: { kind: AsyncFixtureKind }) {
  const [result, setResult] = useState("");
  const recovery: ErrorRecovery = {
    signIn: () => setResult("Sign in requested"),
    requestAccess: () => setResult("Access requested"),
    switchAccount: () => setResult("Account switch requested"),
    goToParent: "/dev/components",
    home: "/",
    resolveConflict: () => setResult("Conflict review requested"),
    manageStorage: "/settings/storage",
    retry: () => setResult("Retry requested"),
    showSavedCopies: () => setResult("Showing saved copies"),
    reload: () => setResult("Reload requested"),
    report: "https://github.com/jeswr/solid-sdk/issues/new",
  };
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <header className="fixture-heading">
        <a href="/dev/components">All components</a>
        <h1>{kind}</h1>
        <p>Async surface states · DS-05</p>
      </header>
      {kind === "empty-state" && (
        <div className="ds05-states">
          {emptyVariants.map((variant) => (
            <section key={variant} data-fixture-state={variant}>
              <h2>{variant}</h2>
              <EmptyState
                variant={variant}
                query="summer"
                onClearFilters={() => setResult("Filters cleared")}
                onRetry={() => setResult("Retry requested")}
                {...(variant === "first-use"
                  ? {
                      primaryAction: (
                        <button
                          type="button"
                          className="suite-async-action"
                          onClick={() => setResult("Upload requested")}
                        >
                          Upload a file
                        </button>
                      ),
                      secondaryAction: (
                        <button
                          type="button"
                          className="suite-async-action"
                          onClick={() => setResult("Document creation requested")}
                        >
                          Create a document
                        </button>
                      ),
                    }
                  : {})}
                {...(variant === "no-access"
                  ? {
                      primaryAction: (
                        <button
                          type="button"
                          className="suite-async-action"
                          onClick={() => setResult("Access requested")}
                        >
                          Request access
                        </button>
                      ),
                      secondaryAction: (
                        <button
                          type="button"
                          className="suite-async-action"
                          onClick={() => setResult("Account switch requested")}
                        >
                          Switch account
                        </button>
                      ),
                    }
                  : {})}
              />
            </section>
          ))}
        </div>
      )}
      {kind === "error-state" && (
        <div className="ds05-states">
          {(Object.keys(errorStateCopy) as ErrorCategory[]).map((category) => (
            <section key={category} data-fixture-state={category}>
              <h2>{category}</h2>
              <ErrorState error={category} actions={recovery} accessRequests />
            </section>
          ))}
          <section data-fixture-state="forbidden-without-access-requests">
            <h2>Access requests unavailable</h2>
            <ErrorState error="forbidden" actions={recovery} />
          </section>
          <section data-fixture-state="retry-after">
            <h2>Retry after</h2>
            <ErrorState
              error={{ category: "unreachable", retryAfterMs: 60000 }}
              actions={recovery}
            />
          </section>
        </div>
      )}
      {kind === "loading-skeleton" && (
        <div className="ds05-states">
          {(["comfortable", "compact"] as const).map((density) => (
            <section key={density} data-density={density} className="fixture-component">
              <h2>{density}</h2>
              {presets.map((preset) => (
                <section key={preset} data-fixture-state={`${density}-${preset}`}>
                  <h3>{preset}</h3>
                  <LoadingSkeleton preset={preset} count={3} label={`Loading ${preset}`} />
                </section>
              ))}
            </section>
          ))}
        </div>
      )}
      {kind === "toasts" && (
        <>
          <section className="fixture-component" data-fixture-state="toast-controls">
            <h2>Notifications</h2>
            <p>Standard: 5 seconds. Undo: 8 seconds. Errors stay until dismissed.</p>
            <div className="fixture-row">
              <button
                type="button"
                className="suite-async-action"
                onClick={() => toast.success("Link copied")}
              >
                Show success
              </button>
              <button
                type="button"
                className="suite-async-action"
                onClick={() =>
                  toast("Moved to trash", {
                    action: { label: "Undo", onClick: () => setResult("File restored") },
                  })
                }
              >
                Show Undo
              </button>
              <button
                type="button"
                className="suite-async-action"
                onClick={() => toast.error("Can't reach your storage")}
              >
                Show error
              </button>
            </div>
          </section>
          <Toaster />
        </>
      )}
      {kind === "render-async" && <AsyncExample />}
      <p role="status" data-testid="async-result">
        {result}
      </p>
    </main>
  );
}
