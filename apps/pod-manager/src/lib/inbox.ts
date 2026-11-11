// AUTHORED-BY Codex GPT-6.1-Sol
/** Bind the shared reader/read-marker API to Pod Manager's active storage. */
import { createInboxManager, type ManagedInbox } from "@jeswr/pod-access/notify";

export type { ReadableNotification as InboxNotification } from "@jeswr/pod-access/notify";
export type Inbox = ManagedInbox;

export async function inboxFor(opts: {
  webId: string;
  activeStorage: string;
  fetchImpl?: typeof fetch;
}): Promise<Inbox | undefined> {
  return (
    (await createInboxManager({
      webId: opts.webId,
      storageRoots: [opts.activeStorage],
      fetch: opts.fetchImpl ?? globalThis.fetch,
    })) ?? undefined
  );
}
