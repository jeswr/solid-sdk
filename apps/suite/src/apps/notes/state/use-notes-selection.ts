// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast, useSelection } from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import { useConnectionState } from "@/shell/sync/connection-state";
import {
  applyNotesBulk,
  bulkFailureMessage,
  bulkNeedsConnection,
  type NotesBulkAction,
  notesBulkActions,
} from "../lib/bulk";
import type { StoredNote } from "../lib/model/store";
import { useNotesContext } from "./notes-context";

type BulkFailure = {
  scope: string;
  action: NotesBulkAction;
  failed: { note: StoredNote; error: unknown }[];
  total: number;
  webId: string | undefined;
};

const changedSinceAction = new Error(
  "This note changed since your action, so it was not retried. Review it and try again.",
);

export function useNotesSelection(visible: readonly StoredNote[], scope: string) {
  const context = useNotesContext();
  const connection = useConnectionState();
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const selection = useSelection({ selectedKeys: keys, onSelectionChange: setKeys });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState<{ scope: string; notes: readonly StoredNote[] }>();
  const running = useRef(false);
  const [failure, setFailure] = useState<BulkFailure>();
  const failureToast = useId();
  const latest = useRef(context);
  latest.current = context;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  const webId = context.session?.webId;
  // The persistent toast must not outlive this view or the account it was raised for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: an account change must dismiss the toast raised for the previous account
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      toast.dismiss(failureToast);
    };
  }, [webId, failureToast]);
  const visibleKey = JSON.stringify(visible.map((note) => note.url));
  useEffect(() => {
    if (busy) return;
    const existing = new Set<string>(JSON.parse(visibleKey));
    setKeys((current) =>
      [...current].every((key) => existing.has(key))
        ? current
        : new Set([...current].filter((key) => existing.has(key))),
    );
  }, [visibleKey, busy]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation resets selection even when the same notes remain visible
  useEffect(() => {
    selectionRef.current.clear();
  }, [scope]);

  const selected =
    busy && inFlight?.scope === scope
      ? inFlight.notes
      : visible.filter((note) => keys.has(note.url));
  async function run(
    action: NotesBulkAction,
    targets = selected,
    selectionScope = scope,
    carried: BulkFailure["failed"] = [],
  ) {
    if (
      running.current ||
      !notesBulkActions(targets).includes(action.type) ||
      (bulkNeedsConnection(action.type) && connection !== "online")
    )
      return;
    running.current = true;
    setInFlight({ scope, notes: selected });
    setBusy(true);
    const startedIn = selectionScope;
    const current = latest.current;
    const startedFor = current.session?.webId;
    const fromSelection = targets.some((note) => keys.has(note.url));
    const result = await applyNotesBulk(targets, action, {
      move: current.move,
      save: current.mutations.save,
      deleteForever: current.mutations.deleteForever,
      pin: current.pin,
      colour: current.colour,
      prefs: current.prefs,
    });
    if (!mounted.current || latest.current.session?.webId !== startedFor) {
      running.current = false;
      return;
    }
    const failedAll = [...result.failed, ...carried];
    if (scopeRef.current === startedIn && (fromSelection || carried.length)) {
      const retained =
        !result.failed.length &&
        ["pin", "unpin", "colour", "addLabel", "removeLabel"].includes(action.type)
          ? targets.filter((note) => keys.has(note.url))
          : [];
      setKeys(
        new Set([...retained.map((note) => note.url), ...failedAll.map(({ note }) => note.url)]),
      );
    }
    const failed = failedAll.length
      ? {
          scope: startedIn,
          action,
          failed: failedAll,
          total: targets.length + carried.length,
          webId: startedFor,
        }
      : undefined;
    announce(failed);
    running.current = false;
    setBusy(false);
  }
  function announce(failed: BulkFailure | undefined) {
    setFailure(failed);
    if (failed)
      toast.error(bulkFailureMessage(failed.failed.length, failed.total, failed.action), {
        id: failureToast,
        duration: Infinity,
        action: { label: "Retry", onClick: () => retry(failed) },
      });
    else toast.dismiss(failureToast);
  }
  const latestRun = useRef(run);
  latestRun.current = run;
  function retry(failed: BulkFailure) {
    // Never write through a stale context, view or session.
    if (!mounted.current || failed.webId !== latest.current.session?.webId) return;
    const destructive = failed.action.type === "trash" || failed.action.type === "deleteForever";
    const ready: StoredNote[] = [];
    const changed: BulkFailure["failed"] = [];
    for (const { note } of failed.failed) {
      const refreshed = latest.current.notes.find((item) => item.url === note.url);
      // A refreshed ETag may only be adopted for non-destructive actions; a changed
      // note keeps failing so the user reviews it before it is trashed or deleted.
      if (destructive && refreshed && refreshed.etag !== note.etag)
        changed.push({ note, error: changedSinceAction });
      else ready.push(destructive ? note : (refreshed ?? note));
    }
    if (ready.length) void latestRun.current(failed.action, ready, failed.scope, changed);
    else if (!running.current) announce({ ...failed, failed: changed });
  }
  return {
    selection,
    selected,
    busy,
    run,
    failure,
    online: connection === "online",
    retry: () => {
      if (failure) retry(failure);
    },
  };
}
