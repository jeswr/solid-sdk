// AUTHORED-BY Codex GPT-6
import { ErrorBoundary, ThemeProvider, ThemeToggle } from "@jeswr/app-shell";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PodConnection } from "./auth/connections.js";
import {
  createPodHttp,
  executeMigration,
  finalizePlan,
  type MigrationPlan,
  type MigrationResult,
  type PodSide,
  type Progress,
  planMigration,
  type Resolutions,
} from "./engine/index.js";
import { ConnectionCard } from "./ui/ConnectionCard.js";
import { PlanReport } from "./ui/Report.js";

export type { MigrationPlan, OptionId, ReportKind, Resolutions } from "./engine/index.js";

const steps = ["Connect source", "Connect target", "Options", "Plan", "Run", "Result"];
const phaseLabels: Record<Progress["phase"], string> = {
  crawl: "Finding your files",
  "read-access": "Reading permissions",
  plan: "Preparing your plan",
  lock: "Protecting destination folders",
  copy: "Copying your files",
  grant: "Applying reviewed permissions",
  verify: "Checking copied files and permissions",
};
const journalKey = "pod-migrator:run-report:v1";
const orderKey = "pod-migrator:swapped:v1";

interface RunReport {
  version: 1;
  status: "running" | "finished" | "interrupted";
  source: { root: string; webId: string };
  target: { root: string; webId: string };
  startedAt: string;
  plan: MigrationPlan;
  resolutions: Resolutions;
  progress: Progress | null;
  result: MigrationResult | null;
  log: { at: string; message: string }[];
}

function readPreviousRun(): RunReport | null {
  try {
    const raw = sessionStorage.getItem(journalKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as RunReport;
    if (
      data?.version !== 1 ||
      !["running", "finished", "interrupted"].includes(data.status) ||
      typeof data.source?.root !== "string" ||
      typeof data.target?.root !== "string" ||
      !Array.isArray(data.log) ||
      !data.log.every((entry) => typeof entry?.at === "string" && typeof entry.message === "string")
    )
      return null;
    const result = data.result;
    if (
      result !== null &&
      (!Array.isArray(result?.copied) ||
        !result.copied.every((url) => typeof url === "string") ||
        !Array.isArray(result.aclWritten) ||
        !result.aclWritten.every((url) => typeof url === "string") ||
        !Array.isArray(result.failed) ||
        !result.failed.every(
          (entry) => typeof entry?.url === "string" && typeof entry.error === "string",
        ) ||
        !Array.isArray(result.skipped) ||
        !result.skipped.every(
          (entry) => typeof entry?.url === "string" && typeof entry.reason === "string",
        ) ||
        !Array.isArray(result.log) ||
        !result.log.every(
          (entry) =>
            typeof entry?.at === "string" &&
            typeof entry.message === "string" &&
            ["info", "warn", "error"].includes(entry.level),
        ) ||
        typeof result.verified !== "boolean" ||
        typeof result.cancelled !== "boolean")
    )
      return null;
    return { ...data, status: data.status === "running" ? "interrupted" : data.status };
  } catch {
    return null;
  }
}

function saveReport(report: RunReport): boolean {
  try {
    sessionStorage.setItem(journalKey, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}

function downloadReport(report: RunReport): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pod-migration-report.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProgressView({
  progress,
  cancelling,
}: {
  progress: Progress | null;
  cancelling: boolean;
}) {
  return (
    <div className="progress-block" aria-live="polite" aria-atomic="true">
      <p className="progress-heading">
        {cancelling
          ? "Stopping after the current request…"
          : progress
            ? phaseLabels[progress.phase]
            : "Getting ready…"}
      </p>
      <progress
        aria-label={progress ? phaseLabels[progress.phase] : "Migration progress"}
        max={progress?.total || 1}
        value={progress && progress.total > 0 ? Math.min(progress.done, progress.total) : undefined}
      />
      {progress && (
        <p className="muted">
          {progress.done} of {progress.total}
          {progress.current && <span className="progress-current">{progress.current}</span>}
        </p>
      )}
    </div>
  );
}

function ResultView({ report }: { report: RunReport }) {
  const result = report.result;
  return (
    <div className="result-view">
      <span className="eyebrow">Migration report</span>
      <h2>
        {!result
          ? "Migration interrupted"
          : result.cancelled
            ? "Migration cancelled"
            : result.failed.length
              ? "Migration finished with failures"
              : "Migration finished"}
      </h2>
      <p>
        {!result
          ? "The last request may have completed. Files may already exist at the destination. Review the log and create a fresh plan before trying again."
          : result.cancelled
            ? "The run has stopped. Files already copied remain at the destination. Review the report before starting again."
            : "Your source files remain in place. Here is what happened at the destination."}
      </p>
      {result && (
        <>
          <dl className="stats">
            <div>
              <dt>Copied</dt>
              <dd>{result.copied.length}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{result.skipped.length}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{result.failed.length}</dd>
            </div>
            <div>
              <dt>Permission documents written</dt>
              <dd>{result.aclWritten.length}</dd>
            </div>
          </dl>
          <p className={`notice ${result.verified ? "success" : "error"}`}>
            <strong>
              {result.verified ? "Verification passed" : "Verification has not passed"}
            </strong>
            <br />
            {result.verified
              ? "The copied data and permission rules were checked."
              : "Do not assume all files and permissions have been verified. Review the failures and run log."}
          </p>
          {result.failed.length > 0 && (
            <section aria-label="Failures">
              <h3>Failures</h3>
              <ul>
                {result.failed.map((failure) => (
                  <li key={failure.url}>
                    <strong className="resource-url">{failure.url}</strong>
                    <p>{failure.error}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.skipped.length > 0 && (
            <details>
              <summary>Skipped files ({result.skipped.length})</summary>
              <ul>
                {result.skipped.map((item) => (
                  <li key={item.url}>
                    {item.url}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <details>
        <summary>Run log</summary>
        <ul className="run-log">
          {report.log.map((entry) => (
            <li key={`${entry.at}-${entry.message}`}>
              <time>{entry.at}</time> {entry.message}
            </li>
          ))}
          {result?.log.map((entry) => (
            <li key={`engine-${entry.at}-${entry.level}-${entry.message}`}>
              <time>{entry.at}</time> [{entry.level}] {entry.message}
            </li>
          ))}
        </ul>
      </details>
      <button type="button" className="primary" onClick={() => downloadReport(report)}>
        Download report JSON
      </button>
    </div>
  );
}

export function App({ connections }: { connections: readonly [PodConnection, PodConnection] }) {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <MigrationApp connections={connections} />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

function MigrationApp({ connections }: { connections: readonly [PodConnection, PodConnection] }) {
  const first = useSyncExternalStore(connections[0].subscribe, connections[0].snapshot);
  const second = useSyncExternalStore(connections[1].subscribe, connections[1].snapshot);
  const [swapped, setSwapped] = useState(() => {
    try {
      return sessionStorage.getItem(orderKey) === "true";
    } catch {
      return false;
    }
  });
  const sourceConnection = connections[swapped ? 1 : 0];
  const targetConnection = connections[swapped ? 0 : 1];
  const sourceState = swapped ? second : first;
  const targetState = swapped ? first : second;
  const [step, setStep] = useState(0);
  const [targetContainer, setTargetContainer] = useState("");
  const [rewriteIris, setRewriteIris] = useState(false);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [busy, setBusy] = useState<"planning" | "running" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [previous, setPrevious] = useState(readPreviousRun);
  const [storageWarning, setStorageWarning] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    for (const connection of connections) void connection.initialize(location.href);
  }, [connections]);
  useEffect(() => {
    if (steps[step]) heading.current?.focus();
  }, [step]);
  useEffect(
    () => () => {
      generation.current++;
      operation.current?.abort();
    },
    [],
  );

  const source = useMemo<PodSide | null>(
    () =>
      sourceState.root && sourceState.webId
        ? {
            root: sourceState.root,
            ownerWebId: sourceState.webId,
            http: createPodHttp({
              root: sourceState.root,
              fetch: sourceConnection.auth.authenticatedFetch,
            }),
          }
        : null,
    [sourceState.root, sourceState.webId, sourceConnection],
  );
  const target = useMemo<PodSide | null>(
    () =>
      targetState.root && targetState.webId
        ? {
            root: targetState.root,
            ownerWebId: targetState.webId,
            http: createPodHttp({
              root: targetState.root,
              fetch: targetConnection.auth.authenticatedFetch,
            }),
          }
        : null,
    [targetState.root, targetState.webId, targetConnection],
  );

  // Invalidate reviewed decisions whenever credentials, storage, or direction change.
  useEffect(() => {
    generation.current++;
    operation.current?.abort();
    operation.current = null;
    setPlan(null);
    setResolutions({});
    setError(null);
    setBusy(null);
    setCancelling(false);
    setTargetContainer(target?.root ?? "");
    setStep((current) =>
      current === 5 ? current : source ? (target ? Math.min(current, 2) : Math.min(current, 1)) : 0,
    );
  }, [source, target]);

  let destination: string | null = null;
  let destinationError: string | null = null;
  if (target && targetContainer.trim()) {
    try {
      destination = assertWithinPodScope(target.root, targetContainer.trim());
      const url = new URL(destination);
      if (!url.pathname.endsWith("/") || url.hash || url.search) throw new Error("Not a container");
      if (source) {
        // Overlapping trees can cause recursive copies or modify the source.
        const overlaps = (a: string, b: string) => {
          try {
            assertWithinPodScope(a, b);
            return true;
          } catch {
            return false;
          }
        };
        if (overlaps(source.root, destination) || overlaps(destination, source.root))
          throw new Error("Overlapping pods");
      }
    } catch {
      destination = null;
      destinationError =
        "Choose a folder URL ending in / inside the target pod, outside the source tree, with no query or fragment.";
    }
  }
  const unresolved =
    plan?.report.filter(
      (item) =>
        item.severity === "needs-decision" &&
        !item.options.some((option) => option.id === resolutions[item.id]),
    ).length ?? 0;
  const aborted = plan?.report.some((item) => resolutions[item.id] === "abort") ?? false;
  const ready = Boolean(
    plan && source && target && destination && !unresolved && !aborted && !busy,
  );

  function invalidateOptions(): void {
    setPlan(null);
    setResolutions({});
    setError(null);
  }

  async function prepare(): Promise<void> {
    if (!source || !target || !destination || operation.current) return;
    const controller = new AbortController();
    const current = ++generation.current;
    operation.current = controller;
    setBusy("planning");
    setStep(3);
    setPlan(null);
    setProgress(null);
    setError(null);
    setCancelling(false);
    try {
      const next = await planMigration({
        source,
        target,
        targetContainer: destination,
        rewriteIris,
        signal: controller.signal,
        onProgress: (value) => {
          if (generation.current === current) setProgress(value);
        },
      });
      if (generation.current !== current) return;
      if (controller.signal.aborted) {
        setStep(2);
        return;
      }
      setPlan(next);
      setResolutions(
        Object.fromEntries(
          next.report
            .filter(
              (item) =>
                item.severity === "info" &&
                item.options.some((option) => option.id === item.recommended),
            )
            .map((item) => [item.id, item.recommended]),
        ),
      );
    } catch {
      if (generation.current === current) {
        if (controller.signal.aborted) setStep(2);
        else
          setError(
            "The plan could not be prepared. Check both sign-ins and pod access, then try again.",
          );
      }
    } finally {
      if (generation.current === current) {
        operation.current = null;
        setBusy(null);
        setCancelling(false);
      }
    }
  }

  async function start(): Promise<void> {
    if (!ready || !plan || !source || !target || operation.current) return;
    let executable: ReturnType<typeof finalizePlan>;
    try {
      executable = finalizePlan(plan, resolutions);
    } catch {
      setError(
        "This plan cannot run safely with the current choices. Review the decisions or create a new plan.",
      );
      return;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    operation.current = controller;
    setBusy("running");
    setStep(4);
    setProgress(null);
    setError(null);
    setCancelling(false);
    setPrevious(null);
    let journal: RunReport = {
      version: 1,
      status: "running",
      source: { root: source.root, webId: source.ownerWebId },
      target: { root: target.root, webId: target.ownerWebId },
      startedAt: new Date().toISOString(),
      plan,
      resolutions,
      progress: null,
      result: null,
      log: [{ at: new Date().toISOString(), message: "Migration started." }],
    };
    const persist = () => {
      if (!saveReport(journal)) setStorageWarning(true);
    };
    persist();
    try {
      const result = await executeMigration(executable, {
        source,
        target,
        signal: controller.signal,
        onProgress: (value) => {
          if (generation.current !== current) return;
          if (journal.progress?.phase !== value.phase)
            journal.log.push({ at: new Date().toISOString(), message: phaseLabels[value.phase] });
          journal = { ...journal, progress: value };
          persist();
          setProgress(value);
        },
      });
      journal = { ...journal, status: "finished", result };
    } catch {
      journal = {
        ...journal,
        status: "interrupted",
        log: [
          ...journal.log,
          {
            at: new Date().toISOString(),
            message: controller.signal.aborted
              ? "Cancellation requested. A complete report was not available."
              : "The migration stopped unexpectedly. Partial writes may have completed.",
          },
        ],
      };
    } finally {
      if (generation.current === current) {
        persist();
        setReport(journal);
        setStep(5);
        setBusy(null);
        setCancelling(false);
        operation.current = null;
      }
    }
  }

  function cancel(): void {
    setCancelling(true);
    operation.current?.abort();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to migration
      </a>
      <header className="app-header">
        <a href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>
          <span>Pod Migrator</span>
        </a>
        <div className="header-actions">
          <span className="badge experimental">Experimental</span>
          <ThemeToggle />
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <span className="eyebrow">A careful move, on your terms</span>
          <h1>Your pod. A new home.</h1>
          <p>Copy your files between Solid pods, with a clear plan for who can access them.</p>
          <div className="safety-note">
            <span aria-hidden="true">◇</span> Review first. Keep control. Your source stays in
            place.
          </div>
        </section>
        <nav aria-label="Migration steps">
          <ol className="stepper">
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={step === index ? "active" : step > index ? "complete" : ""}
              >
                <span className="step-number" aria-hidden="true">
                  {step > index ? "✓" : index + 1}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </nav>
        <div className="workspace">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Step {step + 1} of 6</span>
              <h2 ref={heading} tabIndex={-1}>
                {steps[step]}
              </h2>
            </div>
            {step < 3 && (
              <button
                type="button"
                className="swap-button"
                disabled={Boolean(busy) || !source || !target}
                onClick={() => {
                  const next = !swapped;
                  try {
                    sessionStorage.setItem(orderKey, String(next));
                  } catch {
                    /* The role order still works for this page. */
                  }
                  setSwapped(next);
                }}
              >
                {" "}
                <span aria-hidden="true">⇄</span> Swap source and target
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {step < 3 && (
            <>
              <p className="section-description">
                {step === 0
                  ? "Start with the account that holds the files you want to copy."
                  : step === 1
                    ? "Sign in to the account that will receive your files. You can use a different provider."
                    : "Choose where your files will go and how links should be handled."}
              </p>
              <div className="connections-grid">
                <ConnectionCard
                  connection={sourceConnection}
                  state={sourceState}
                  side="source"
                  disabled={Boolean(busy)}
                />
                <div className="direction" aria-hidden="true">
                  →
                </div>
                <ConnectionCard
                  connection={targetConnection}
                  state={targetState}
                  side="target"
                  disabled={Boolean(busy)}
                />
              </div>
            </>
          )}
          {step === 0 && (
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={!source}
                onClick={() => setStep(1)}
              >
                Continue to target <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          {step === 1 && (
            <div className="actions">
              <button type="button" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={!source || !target}
                onClick={() => setStep(2)}
              >
                Continue to options <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          {step === 2 && (
            <>
              <section className="options-panel" aria-label="Migration options">
                <label className="field">
                  Target folder URL{" "}
                  <input
                    type="url"
                    value={targetContainer}
                    aria-describedby="destination-help"
                    onChange={(event) => {
                      invalidateOptions();
                      setTargetContainer(event.target.value);
                    }}
                  />
                </label>
                <p className="muted" id="destination-help">
                  Defaults to your target storage root. A folder URL must end in /.
                </p>
                {destinationError && (
                  <p className="notice error" role="alert">
                    {destinationError}
                  </p>
                )}
                <label className="toggle-option">
                  <input
                    type="checkbox"
                    checked={rewriteIris}
                    onChange={(event) => {
                      invalidateOptions();
                      setRewriteIris(event.target.checked);
                    }}
                  />
                  <span>
                    <strong>Update links inside linked-data files</strong>
                    <small>
                      Rewrite IRIs{" "}
                      <abbr title="An IRI is an identifier such as a web address in a linked-data document.">
                        ⓘ
                      </abbr>{" "}
                      that point into the source pod so they point into the target pod. Off by
                      default; otherwise file contents are copied unchanged.
                    </small>
                  </span>
                </label>
              </section>
              <div className="notice">
                <strong>Planning only reads your pods.</strong> Nothing is written until you review
                the plan and select Start migration.
              </div>
              <div className="actions">
                <button type="button" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!source || !target || !destination}
                  onClick={() => {
                    void prepare();
                  }}
                >
                  Create migration plan <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              {busy === "planning" && (
                <>
                  <ProgressView progress={progress} cancelling={cancelling} />
                  <button type="button" disabled={cancelling} onClick={cancel}>
                    Cancel planning
                  </button>
                </>
              )}
              {plan && !busy && (
                <>
                  <p className="section-description">
                    Review the destination and every permission choice. Nothing has been written
                    yet.
                  </p>
                  <div className="route-summary">
                    <div>
                      <span className="muted">From</span>
                      <p>{source?.root}</p>
                    </div>
                    <span aria-hidden="true">→</span>
                    <div>
                      <span className="muted">To</span>
                      <p>{destination}</p>
                    </div>
                  </div>
                  <dl className="stats">
                    <div>
                      <dt>Files</dt>
                      <dd>{plan.stats.resources}</dd>
                    </div>
                    <div>
                      <dt>Folders</dt>
                      <dd>{plan.stats.containers}</dd>
                    </div>
                    <div>
                      <dt>Bytes</dt>
                      <dd>{plan.stats.bytes.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Permission documents</dt>
                      <dd>{plan.stats.aclDocuments}</dd>
                    </div>
                  </dl>
                  <p className="muted">
                    Permission systems:{" "}
                    <abbr title="Web Access Control (WAC) and Access Control Policies (ACP) describe who can access pod data.">
                      {plan.sourceSystem.toUpperCase()} → {plan.targetSystem.toUpperCase()}
                    </abbr>
                  </p>
                  <PlanReport plan={plan} resolutions={resolutions} onChange={setResolutions} />
                  <div aria-live="polite" className={`notice ${aborted ? "error" : ""}`}>
                    {aborted ? (
                      <>
                        <strong>Migration will not run.</strong> An abort choice is selected. Change
                        it to a safe option or go back.
                      </>
                    ) : unresolved ? (
                      `${unresolved} permission ${unresolved === 1 ? "decision still needs" : "decisions still need"} your choice.`
                    ) : (
                      "All required decisions are resolved. You can start when you are ready."
                    )}
                  </div>
                  <div className="actions">
                    <button type="button" onClick={() => setStep(2)}>
                      Back to options
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!ready}
                      onClick={() => {
                        void start();
                      }}
                    >
                      Start migration
                    </button>
                  </div>
                </>
              )}
              {!busy && !plan && (
                <button type="button" onClick={() => setStep(2)}>
                  Back to options
                </button>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <p>Keep this tab open while the migration runs.</p>
              <ProgressView progress={progress} cancelling={cancelling} />
              <ol className="run-phases">
                {(["lock", "copy", "grant", "verify"] as const).map((phase) => (
                  <li key={phase} aria-current={progress?.phase === phase ? "step" : undefined}>
                    {phaseLabels[phase]}
                  </li>
                ))}
              </ol>
              <p className="muted">
                Cancel stops after the current request. Files already copied remain at the
                destination.
              </p>
              <button type="button" className="danger" disabled={cancelling} onClick={cancel}>
                Cancel migration
              </button>
            </>
          )}
          {step === 5 && report && (
            <>
              <ResultView report={report} />
              <div className="actions">
                <button
                  type="button"
                  onClick={() => {
                    setPlan(null);
                    setReport(null);
                    setStep(0);
                  }}
                >
                  Plan another migration
                </button>
              </div>
            </>
          )}
          {storageWarning && (
            <p role="status" className="notice">
              This browser could not save the run log for reload. Download the report before
              leaving.
            </p>
          )}
        </div>
        {previous && (
          <details className="previous-run">
            <summary>
              Report from your previous run{" "}
              {previous.status === "interrupted" ? "(interrupted)" : ""}
            </summary>
            <ResultView report={previous} />
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem(journalKey);
                } catch {
                  /* Storage may be blocked. */
                }
                setPrevious(null);
              }}
            >
              Dismiss previous report
            </button>
          </details>
        )}
      </main>
      <footer>
        <span>Made for your Solid data.</span>
        <span>Experimental software · Review your plan carefully.</span>
      </footer>
    </div>
  );
}
