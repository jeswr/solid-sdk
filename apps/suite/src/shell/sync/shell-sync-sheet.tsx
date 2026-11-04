// AUTHORED-BY Claude Opus 5.5
"use client";
/** The shell's SyncSheet and ConflictDialog, wired to the active account's outbox. */
import { ConflictDialog, type SyncConflict, SyncSheet } from "@jeswr/suite-ui/sync";
import { useState } from "react";
import { useOutbox } from "./offline-provider";
import { useSyncSnapshot } from "./online";

export function ShellSyncSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snapshot = useSyncSnapshot();
  const outbox = useOutbox();
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [deciding, setDeciding] = useState(false);
  return (
    <>
      <SyncSheet
        open={open}
        onOpenChange={onOpenChange}
        snapshot={snapshot}
        onRetryAll={() => void outbox.retryAll()}
        onRetry={(id) => void outbox.retry(id)}
        onResolve={(id) => {
          const found = snapshot.conflicts.find((item) => item.id === id);
          if (!found) return;
          setConflict(found);
          setDeciding(true);
        }}
      />
      <ConflictDialog
        open={deciding}
        onOpenChange={setDeciding}
        conflict={conflict}
        onChoose={(strategy) => {
          setDeciding(false);
          if (conflict) void outbox.resolve(conflict.id, strategy);
        }}
      />
    </>
  );
}
