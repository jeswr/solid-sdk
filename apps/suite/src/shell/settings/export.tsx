// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Checkbox, Progress } from "@jeswr/suite-ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccounts } from "../session/accounts-provider";
import { exportApps, exportRootFolders } from "./export-apps";
import { createTakeoutJob, exportFilename, type TakeoutState } from "./export-job";

const bytes = (value: number) => `${value.toLocaleString()} bytes`;
const empty: TakeoutState = { phase: "idle" };

export function ExportSettings() {
  const { active } = useAccounts();
  if (!active) return <p>Sign in to export your pod.</p>;
  return <AccountExportSettings key={`${active.id}:${active.storageUrl}`} />;
}

function AccountExportSettings() {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const [job, setJob] = useState<ReturnType<typeof createTakeoutJob>>();
  const [choices, setChoices] = useState<{ url: string; label: string }[]>([]);
  const [everything, setEverything] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const activeId = accounts.active?.id;
  const storageUrl = accounts.active?.storageUrl;
  const webId = accounts.active?.webId;
  const waiting = useRef(new Set<() => void>());
  useEffect(() => {
    if (accounts.status === "ready") for (const resume of waiting.current) resume();
  }, [accounts.status]);
  useEffect(() => {
    if (!activeId || !storageUrl || !webId) {
      setJob(undefined);
      return;
    }
    const controller = new AbortController();
    const sameAccount = () =>
      latest.current.active?.id === activeId &&
      latest.current.active.storageUrl === storageUrl &&
      (latest.current.status !== "ready" || latest.current.isActiveAccount(activeId));
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const signal = init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      signal.throwIfAborted();
      while (sameAccount() && latest.current.status !== "ready") {
        await new Promise<void>((resolve, reject) => {
          const resume = () => {
            waiting.current.delete(resume);
            signal.removeEventListener("abort", abort);
            resolve();
          };
          const abort = () => {
            waiting.current.delete(resume);
            reject(signal.reason);
          };
          waiting.current.add(resume);
          signal.addEventListener("abort", abort, { once: true });
        });
      }
      if (!sameAccount()) throw new Error("Account changed");
      const response = await latest.current.fetch(input, init);
      if (controller.signal.aborted || !sameAccount()) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Account changed");
      }
      return response;
    };
    const next = createTakeoutJob(fetch, storageUrl);
    setJob(next);
    setChoices([]);
    setEverything(true);
    setSelected([]);
    void next.plan();
    void exportRootFolders(fetch, storageUrl, controller.signal)
      .then((folders) => {
        if (controller.signal.aborted) return;
        setChoices((current) => {
          const merged = new Map(folders.map((item) => [item.url, item]));
          for (const item of current) merged.set(item.url, item);
          return [...merged.values()];
        });
      })
      .catch(() => {});
    void exportApps(fetch, storageUrl, webId, controller.signal)
      .then((apps) => {
        if (!controller.signal.aborted)
          setChoices((current) => {
            const merged = new Map(current.map((item) => [item.url, item]));
            for (const app of apps) merged.set(app.url, app);
            return [...merged.values()];
          });
      })
      .catch(() => {});
    return () => {
      controller.abort();
      next.dispose();
    };
  }, [activeId, storageUrl, webId]);
  const state = useSyncExternalStore(
    job?.subscribe ?? (() => () => {}),
    job?.snapshot ?? (() => empty),
    () => empty,
  );
  useEffect(() => {
    if (state.phase !== "exporting" && !state.download) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.phase, state.download]);
  const fileCount = useMemo(
    () =>
      state.plan?.resources.reduce((count, item) => count + Number(item.kind !== "container"), 0) ??
      0,
    [state.plan],
  );
  const busy = state.phase === "planning" || state.phase === "exporting";
  const choose = (all: boolean, urls: string[]) => {
    setEverything(all);
    setSelected(urls);
    void job?.plan(all ? undefined : urls);
  };
  const skipped = useMemo(
    () => state.manifest?.entries.filter((entry) => entry.error) ?? [],
    [state.manifest],
  );
  return (
    <section aria-labelledby="export-heading">
      <h2 id="export-heading">Download your data</h2>
      <p>
        Save a ZIP of your readable pod files, including linked access and metadata documents. Your
        pod stays as it is.
      </p>
      <fieldset disabled={state.phase === "exporting"}>
        <legend>What to export</legend>
        <label className="settings-toggle">
          <input
            type="radio"
            name="export-scope"
            checked={everything}
            onChange={() => choose(true, [])}
          />
          Everything
        </label>
        <label className="settings-toggle">
          <input
            type="radio"
            name="export-scope"
            checked={!everything}
            onChange={() => choose(false, selected)}
          />
          Choose folders or apps
        </label>
        {!everything &&
          choices.map((choice, index) => (
            <label
              key={choice.url}
              htmlFor={`export-choice-${index}`}
              className="settings-toggle export-choice"
            >
              <Checkbox
                id={`export-choice-${index}`}
                checked={selected.includes(choice.url)}
                onCheckedChange={(checked) =>
                  choose(
                    false,
                    checked === true
                      ? [...selected, choice.url]
                      : selected.filter((url) => url !== choice.url),
                  )
                }
              />
              {choice.label}
            </label>
          ))}
        {!everything && !choices.length && <p>No folders or app registrations were found.</p>}
      </fieldset>
      <div role="status" aria-live="polite">
        {state.phase === "planning" && <p>Estimating your export…</p>}
        {state.plan && (
          <p>
            Estimate: {fileCount} files, {bytes(state.plan.estimatedBytes)}
            {state.plan.unknownSizes > 0 &&
              `, plus ${state.plan.unknownSizes} files of unknown size`}
            .
          </p>
        )}
        {state.progress && (
          <p>
            {state.progress.files} of {state.progress.totalFiles} files processed ·{" "}
            {bytes(state.progress.bytes)} read
          </p>
        )}
        {state.phase === "cancelled" && <p>Export cancelled.</p>}
        {state.phase === "complete" && (
          <p>
            {state.saved ? "Export saved." : "Export ready."} {skipped.length} items skipped or
            incomplete.
          </p>
        )}
      </div>
      {state.phase === "exporting" && (
        <Progress
          aria-label="Export progress"
          max={Math.max(1, state.progress?.totalFiles ?? 1)}
          value={state.progress?.files ?? 0}
        />
      )}
      {state.warning && <p role="note">{state.warning}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <div className="settings-choice-row">
        {busy ? (
          <Button variant="outline" onClick={() => job?.cancel()}>
            Cancel
          </Button>
        ) : state.download ? (
          <Button asChild>
            <a href={state.download} download={exportFilename()}>
              Download ZIP
            </a>
          </Button>
        ) : (
          <Button
            disabled={!job || state.phase !== "ready" || (!everything && selected.length === 0)}
            onClick={() => void job?.start()}
          >
            Start export
          </Button>
        )}
        {!busy && state.phase !== "ready" && (
          <Button
            variant="outline"
            onClick={() => void job?.plan(everything ? undefined : selected)}
          >
            Refresh estimate
          </Button>
        )}
      </div>
      {skipped.length > 0 && (
        <details>
          <summary>Skipped or incomplete items ({skipped.length})</summary>
          <ul>
            {skipped.map((entry) => (
              <li key={entry.url} className="export-skipped">
                {entry.url}: {entry.error?.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
