// AUTHORED-BY Codex GPT-6
"use client";
import {
  createSourceAuth,
  fileAdapterById,
  type ImportProgress,
  type ImportReport,
  runFileImport,
  runImport,
  type SourceAuth,
} from "@jeswr/pod-connectors";
import { EmptyState, ErrorState, Progress } from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type ConnectorEntry, destinationsFor } from "../../lib/connect/catalogue";
import type { ConnectionMode } from "../../lib/connect/connection-state";
import {
  addedCopy,
  connectorErrorCopy,
  progressCopy,
  scopeLabel,
  skippedCopy,
} from "../../lib/connect/copy";
import type { DataCategory } from "../../lib/model/domains";
import { useConnectors } from "../../state/connectors";
import { useHomeSession } from "../home-app";
import { domainForWrittenDocument } from "./completion";
import { entries, registry } from "./config";
import {
  createImportWriter,
  fetchWithSignal,
  fileWithSignal,
  runSavedImport,
} from "./import-service";
import { login, sourceFetch } from "./oauth-login";
import { requiredScopesFor, withRequiredScopes, withSelectedScopes } from "./scopes";
import { ConnectorLogo, StatusBadge } from "./shared";
import { useOnline } from "./use-online";

export function ConnectFlow({ service }: { service: string }) {
  // The server route has already validated the id against this same catalogue.
  const entry = entries.find((candidate) => candidate.id === service) as ConnectorEntry;
  return <ServiceFlow key={service} entry={entry} />;
}

function ServiceFlow({ entry }: { entry: ConnectorEntry }) {
  const session = useHomeSession();
  const [, update] = useConnectors(session.webId);
  const online = useOnline();
  const adapter = registry.adapterById(entry.id);
  const fileAdapter = fileAdapterById(entry.id);
  const metadata = entry.tier === "C" ? fileAdapter?.metadata : adapter?.metadata;
  const scopes = metadata?.scopes ?? [];
  const [selected, setSelected] = useState<readonly string[]>(scopes);
  const required = requiredScopesFor(entry.id);
  const selectedScopes = withRequiredScopes(entry.id, selected);
  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState<
    "idle" | "waiting" | "running" | "done" | "error" | "cancelled"
  >("idle");
  const [progress, setProgress] = useState<ImportProgress>();
  const [written, setWritten] = useState(0);
  const [report, setReport] = useState<ImportReport>();
  const [importedDomains, setImportedDomains] = useState<readonly DataCategory[]>([]);
  const [failure, setFailure] = useState<unknown>();
  const [blockedHref, setBlockedHref] = useState<string>();
  const [popupClosed, setPopupClosed] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The heading of whichever step or result panel is showing; it takes focus when the
  // panel changes, because the control that changed it has just unmounted.
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const view = useRef(`${step}:${phase}`);
  const mode: ConnectionMode =
    entry.status === "demo" ? "demo" : entry.tier === "C" ? "file" : "live";
  const destinations = destinationsFor(entry.id);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!online) controller.current?.abort();
  }, [online]);
  useEffect(() => {
    // Compare views rather than counting effect runs, so a remount never steals focus.
    if (view.current === `${step}:${phase}`) return;
    view.current = `${step}:${phase}`;
    panelHeading.current?.focus();
  }, [step, phase]);

  async function start(file?: File) {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setFailure(undefined);
    setBlockedHref(undefined);
    setPopupClosed(false);
    setNotice("");
    setWritten(0);
    setImportedDomains([]);
    setProgress(undefined);
    setPhase(mode === "live" && adapter?.oauth ? "waiting" : "running");
    const domainsByResource = new Map<string, DataCategory>();
    const oauth = mode === "live" ? adapter?.oauth : undefined;
    let started = false;
    try {
      const result = await runSavedImport(
        session.storageUrl,
        entry.id,
        mode,
        abort.signal,
        (action) => update(entry.id, action),
        async (cursor, connection, sourceAuth: SourceAuth | undefined) => {
          started = true;
          abort.signal.throwIfAborted();
          setBlockedHref(undefined);
          setStep(3);
          setPhase("running");
          const writer = createImportWriter(
            session,
            entry.id,
            abort.signal,
            (url, doc) => {
              if (doc.slug === "_provenance.ttl") return;
              update(entry.id, { type: "written", url });
              const domain = domainForWrittenDocument(doc);
              if (domain) domainsByResource.set(url, domain);
              else domainsByResource.delete(url);
              // Progress counts successful documents until the runner supplies item counts.
              setWritten((count) => count + 1);
            },
            mode === "demo" ? [] : connection.demoResourceUrls,
          );
          const onProgress = (value: ImportProgress) => {
            abort.signal.throwIfAborted();
            setProgress(value);
          };
          return mode === "file" && fileAdapter && file
            ? await runFileImport({
                adapter: fileAdapter,
                file: fileWithSignal(file, abort.signal),
                podWriter: writer,
                onProgress,
              })
            : await runImport({
                adapter: withSelectedScopes(adapter as NonNullable<typeof adapter>, selectedScopes),
                mode: mode === "demo" ? "demo" : "live",
                ...(sourceAuth ? { sourceAuth } : {}),
                podWriter: writer,
                // Demo replays complete fixtures; live resumes the successful checkpoint.
                ...(cursor ? { cursor } : {}),
                onProgress,
                // Cancel also ends waits between source requests (rate-limit backoff).
                signal: abort.signal,
              });
        },
        // Sign in before the run is recorded: abandoning sign-in is not a sync attempt.
        oauth && adapter
          ? async () => {
              const config = { ...oauth, scopes: selectedScopes };
              const token = await login(entry.id, config, abort.signal, setBlockedHref, () =>
                setPopupClosed(true),
              );
              const transport = fetchWithSignal(sourceFetch, abort.signal);
              return (
                adapter.createSourceAuth?.(config, token, transport) ??
                createSourceAuth(entry.id, adapter, token, transport)
              );
            }
          : undefined,
      );
      const completed = new Map<string, DataCategory>();
      for (const { url } of result.written) {
        const domain = domainsByResource.get(url);
        if (domain) completed.set(domain.id, domain);
      }
      setImportedDomains([...completed.values()]);
      setReport(result);
      setPhase("done");
    } catch (error) {
      if (abort.signal.aborted && !started) {
        // Nothing was imported or recorded: return to sign-in.
        setPhase("idle");
        setNotice(`Sign-in to ${entry.name} cancelled.`);
      } else {
        setFailure(error);
        setPhase(abort.signal.aborted ? "cancelled" : "error");
      }
    } finally {
      running.current = false;
      controller.current = null;
    }
  }
  function retry() {
    setPhase("idle");
    setStep(1);
    setReport(undefined);
    setBlockedHref(undefined);
    setNotice("");
  }
  const total = progress?.total;
  // One always-mounted live region; its text changes, so every outcome is announced.
  const announcement =
    phase === "waiting"
      ? popupClosed
        ? `Didn't finish signing in to ${entry.name}? Choose Cancel to stop waiting.`
        : `Waiting for ${entry.name}…`
      : phase === "running"
        ? total !== undefined && progress
          ? progressCopy(progress.done, total, "collections")
          : progressCopy(written, undefined, "collections")
        : phase === "done" && report
          ? [
              addedCopy(
                report.state?.counts.items ?? report.written.length,
                importedDomains.map((domain) => domain.label).join(", ") || "your pod",
              ),
              skippedCopy(report.skipped ?? 0),
            ]
              .filter(Boolean)
              .join(". ")
              .concat(".")
          : phase === "cancelled"
            ? "Last sync incomplete. Items already added are kept."
            : phase === "error"
              ? `${entry.name} sync didn't finish. ${connectorErrorCopy(failure, entry.name)}`
              : notice;
  if (!online)
    return (
      <div className="hm-connect hm-connect-page">
        <h1>Connect {entry.name}</h1>
        <EmptyState
          variant="not-available-offline"
          title="Connecting services needs a connection"
          body="Reconnect to connect services."
        />
      </div>
    );

  return (
    <div className="hm-connect hm-connect-page">
      <Link className="hm-connect-back" href="/connect">
        Connect services
      </Link>
      <div className="hm-connect-flow-header">
        <ConnectorLogo entry={entry} />
        <div>
          <h1>Synchronise your {entry.name} data</h1>
          <StatusBadge status={entry.status} />
        </div>
      </div>
      <div className="hm-connect-columns">
        <section className="hm-connect-flow" aria-label={`Connect ${entry.name}`}>
          <ol className="hm-connect-stepper" aria-label="Connection steps">
            {[
              "Choose what to sync",
              entry.tier === "C" ? "Import a file" : `Sign in to ${entry.name}`,
              "Importing",
            ].map((label, index) => (
              <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
                <span aria-hidden="true">{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <p className="hm-connect-sr-only" role="status" aria-live="polite" aria-atomic="true">
            {announcement}
          </p>
          {entry.status === "soon" ? (
            <p>Coming soon</p>
          ) : phase === "done" && report ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                {addedCopy(
                  report.state?.counts.items ?? report.written.length,
                  importedDomains.map((domain) => domain.label).join(", ") || "your pod",
                )}
              </h2>
              {!!report.skipped && <p>{skippedCopy(report.skipped)}</p>}
              {report.unsupported?.length ? (
                <p>Some parts of this export aren't supported yet.</p>
              ) : null}
              <div className="hm-connect-actions">
                {importedDomains.map((domain) => (
                  <Link
                    key={domain.id}
                    className="hm-connect-button"
                    href={domain.id === "personal" ? "/home" : `/home/${domain.id}`}
                  >
                    See in {domain.label}
                  </Link>
                ))}
                <button
                  type="button"
                  className="hm-connect-button hm-connect-secondary"
                  onClick={retry}
                >
                  Sync again
                </button>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                {entry.name} sync didn't finish
              </h2>
              <ErrorState error="unknown">
                <p>{connectorErrorCopy(failure, entry.name)}</p>
                <button type="button" className="hm-connect-button" onClick={retry}>
                  Try again
                </button>
              </ErrorState>
            </div>
          ) : phase === "cancelled" ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                Last sync incomplete
              </h2>
              <p>Items already added are kept. You can sync again to finish.</p>
              <button type="button" className="hm-connect-button" onClick={retry}>
                Sync again
              </button>
            </div>
          ) : phase === "running" ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                Importing
              </h2>
              <Progress
                aria-label="Import progress"
                value={
                  progress?.total ? Math.min(100, (progress.done / progress.total) * 100) : null
                }
              />
              <p>{progress?.label}</p>
              <p>{announcement}</p>
              <button
                type="button"
                className="hm-connect-button hm-connect-secondary"
                onClick={() => controller.current?.abort()}
              >
                Cancel
              </button>
            </div>
          ) : step === 1 ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                Choose what to sync
              </h2>
              {scopes.length ? (
                <fieldset className="hm-connect-scopes">
                  <legend>Data to synchronise</legend>
                  {scopes.map((scope) => (
                    <label key={scope}>
                      <input
                        type="checkbox"
                        checked={selected.includes(scope)}
                        disabled={required.includes(scope)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, scope]
                              : current.filter((value) => value !== scope),
                          )
                        }
                      />
                      {scopeLabel(scope)}
                      {required.includes(scope) && (
                        <span> — Required to identify your account before importing.</span>
                      )}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p>{entry.whatYouGet}</p>
              )}
              <button
                type="button"
                className="hm-connect-button"
                disabled={scopes.length > 0 && selected.length === 0}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          ) : entry.tier === "C" && fileAdapter ? (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                Import a file
              </h2>
              <p>{fileAdapter.fileHint}</p>
              <label
                className="hm-connect-drop"
                htmlFor="connector-file"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void start(file);
                }}
              >
                Export file — drop it here or choose a file
                <input
                  className="hm-connect-file"
                  ref={fileInput}
                  id="connector-file"
                  type="file"
                  accept={fileAdapter.accept}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void start(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="hm-connect-button"
                onClick={() => fileInput.current?.click()}
              >
                Choose file
              </button>
              <details>
                <summary>How to export from {entry.name}</summary>
                <p>{fileAdapter.fileHint}</p>
                {fileAdapter.exportUrl && (
                  <a href={fileAdapter.exportUrl} target="_blank" rel="noopener noreferrer">
                    Export your {entry.name} data
                  </a>
                )}
              </details>
            </div>
          ) : (
            <div className="hm-connect-result">
              <h2 ref={panelHeading} tabIndex={-1}>
                Sign in to {entry.name}
              </h2>
              {mode === "demo" && (
                <p>
                  No sign-in is needed. This imports recorded demo data from {entry.name} into your
                  pod.
                </p>
              )}
              {phase === "waiting" ? (
                <>
                  <p>Waiting for {entry.name}…</p>
                  {blockedHref && (
                    <p>
                      Your browser blocked the sign-in window.{" "}
                      <a
                        className="hm-connect-button"
                        href={blockedHref}
                        target="suite-connector-auth"
                        rel="noopener"
                      >
                        Open {entry.name} sign-in
                      </a>
                    </p>
                  )}
                  {popupClosed && <p>Didn't finish signing in?</p>}
                  <button
                    type="button"
                    className="hm-connect-button hm-connect-secondary"
                    onClick={() => controller.current?.abort()}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {notice && <p>{notice}</p>}
                  <button type="button" className="hm-connect-button" onClick={() => void start()}>
                    Continue with {entry.name}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
        <aside className="hm-connect-about" aria-label={`About ${entry.name}`}>
          <h2>About {entry.name}</h2>
          <h3>What you get</h3>
          <p>{entry.whatYouGet}</p>
          <h3>Requirements</h3>
          {metadata?.requirements.length ? (
            <ul>
              {metadata.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : (
            <p>Your exported file from {entry.name}.</p>
          )}
          <h3>Where it goes</h3>
          <ul>
            {destinations.map(({ label }) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
