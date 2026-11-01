// AUTHORED-BY GPT-5.6 Codex
import { checkRejectedShare, checkTextShareDelivery } from "./checks.ts";

interface ShareEvidence {
  documentId: string;
  pending: { id: string }[];
  events: unknown[];
}

interface ShareProbe {
  refresh: () => Promise<ShareEvidence>;
  poll: (label: string, probe: () => Promise<ShareEvidence>) => Promise<ShareEvidence>;
}

export async function waitForTextShare(text: string, documentId: string, probe: ShareProbe) {
  return probe.poll("the exact shared text and notification", async () => {
    const shares = await probe.refresh();
    const failures = checkTextShareDelivery(
      shares.pending,
      shares.events,
      text,
      documentId,
      shares.documentId,
    );
    if (failures.length) throw new Error(failures.join("\n"));
    return shares;
  });
}

export async function verifyRejectedShare(
  controlText: string,
  documentId: string,
  probe: ShareProbe & {
    sendRejected: () => Promise<unknown>;
    sendControl: () => Promise<unknown>;
    acknowledge: (batchId: string) => Promise<ShareEvidence>;
  },
) {
  await probe.sendRejected();
  await probe.sendControl();
  // ShareReceiverActivity.COPIER is a single-thread executor. Processing this fresh control
  // proves the preceding request finished, even if neither activity appeared in dumpsys.
  const control = await waitForTextShare(controlText, documentId, probe);
  // Exactly the control batch/event is allowed, so a rejected file or fallback text fails
  // before acknowledge clears the listener's history.
  const batch = control.pending[0];
  if (!batch) throw new Error("Missing control share batch");
  const cleared = await probe.acknowledge(batch.id);
  const failures = checkRejectedShare(cleared.pending, cleared.events);
  if (failures.length) throw new Error(failures.join("\n"));
  return { control, cleared };
}
