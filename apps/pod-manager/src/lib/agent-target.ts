// AUTHORED-BY Codex GPT-6.1-Sol
/** Shared notification transport also protects foreign poll/profile reads. */
import { createInboxReader, createNotifyFetch } from "@jeswr/pod-access/notify";

export function noFollowFetch(fetchImpl?: typeof fetch): typeof fetch {
  return createNotifyFetch({ fetch: fetchImpl ?? globalThis.fetch });
}

export async function discoverInbox(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  return (
    (await createInboxReader({ fetch: fetchImpl ?? globalThis.fetch }).inbox(webId)) ?? undefined
  );
}
