// AUTHORED-BY GPT-6.1 Sol
import type { Identity, PodAuth } from "@jeswr/pod-auth";
import { DiaryStore } from "../cache/diary-store";
import { defaultKv } from "../cache/kv";

/** Capture the last account before restore can forget its expired credential pointer. */
export async function restoreDiarySession(
  core: PodAuth,
  onPurgeFailure: (store: DiaryStore) => void,
): Promise<Identity | null> {
  const [account] = await core.remembered().catch(() => []);
  let expired = false;
  const stop = core.on("expired", () => {
    expired = true;
  });
  let restored: Identity | null | undefined;
  try {
    restored = await core.restore();
    return restored;
  } finally {
    stop();
    // A thrown transient restore error alone does not establish session loss.
    if (account && (expired || restored === null)) {
      const store = new DiaryStore(defaultKv(), account.webId);
      try {
        await store.purge();
      } catch {
        onPurgeFailure(store);
      }
    }
  }
}
