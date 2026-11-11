// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
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
  const failed = () => toast("Couldn't sync this change. It is still saved on this device.");
  return (
    <>
      <SyncSheet
        open={open}
        onOpenChange={onOpenChange}
        snapshot={snapshot}
        onRetryAll={() => void outbox.retryAll().catch(failed)}
        onRetry={(id) => void outbox.retry(id).catch(failed)}
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
        conflict={snapshot.conflicts.find((item) => item.id === conflict?.id) ?? null}
        onChoose={(strategy) => {
          setDeciding(false);
          if (conflict) void outbox.resolve(conflict.id, strategy).catch(failed);
        }}
      />
    </>
  );
}
