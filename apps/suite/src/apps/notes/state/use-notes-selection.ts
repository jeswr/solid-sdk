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
};

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
  async function run(action: NotesBulkAction, targets = selected, selectionScope = scope) {
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
    const result = await applyNotesBulk(targets, action, {
      move: current.move,
      save: current.mutations.save,
      deleteForever: current.mutations.deleteForever,
      pin: current.pin,
      colour: current.colour,
      prefs: current.prefs,
    });
    if (scopeRef.current === startedIn) {
      const retained =
        !result.failed.length &&
        ["pin", "unpin", "colour", "addLabel", "removeLabel"].includes(action.type)
          ? targets.filter((note) => keys.has(note.url))
          : [];
      setKeys(
        new Set([
          ...retained.map((note) => note.url),
          ...result.failed.map(({ note }) => note.url),
        ]),
      );
    }
    const failed = result.failed.length
      ? { scope: startedIn, action, failed: result.failed, total: targets.length }
      : undefined;
    setFailure(failed);
    if (failed)
      toast.error(bulkFailureMessage(failed.failed.length, failed.total, action), {
        id: failureToast,
        duration: Infinity,
        action: { label: "Retry", onClick: () => retry(failed) },
      });
    else toast.dismiss(failureToast);
    running.current = false;
    setBusy(false);
  }
  const latestRun = useRef(run);
  latestRun.current = run;
  function retry(failed: BulkFailure) {
    void latestRun.current(
      failed.action,
      failed.failed.map(
        ({ note }) => latest.current.notes.find((item) => item.url === note.url) ?? note,
      ),
      failed.scope,
    );
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
