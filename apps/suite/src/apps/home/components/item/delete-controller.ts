// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { DomainItem } from "../../lib/model/discovery";
import { linkedProtectedDocument, protectedDocument } from "../../state/protected-document";
import type { HomeSession } from "../../state/use-domain-items";
import { ItemReadError, isContainer, readItem } from "./data";

export const UNDO_MS = 8_000;
/**
 * While a toast holds a deletion (its timer pauses on hover and focus), this page's own
 * timer waits this much longer before committing anyway, e.g. when no toast is shown.
 */
export const HOLD_GRACE_MS = 30_000;
/**
 * A claim older than this is from a tab that closed mid-commit: another tab may take it over.
 * A live committer re-checks its claim right before its DELETE, so it never deletes after that.
 */
export const CLAIM_STALE_MS = 120_000;
/** How often a tab waiting on another tab's claim looks again, besides storage events. */
export const CLAIM_POLL_MS = 1_000;
/** What survives a reload. Item content is never copied into browser storage. */
interface Tombstone {
  url: string;
  etag: string;
  deleteAt: number;
  /** Set by the tab that is committing the deletion, so no other tab can still undo it. */
  claim?: { by: string; at: number };
  /**
   * Set by the tab holding the saved copy when its Undo meets another tab's claim: that
   * committer must then send no DELETE, and the Undo tab restores the copy once it is done.
   */
  undone?: true;
}
interface PendingDelete {
  tombstone: Tombstone;
  /** This page's captured copy; a resumed entry has none because nothing was removed yet. */
  restore?: { body: string | Uint8Array<ArrayBuffer>; contentType: string };
  /** Whether the tombstone reached browser storage, so other tabs can cancel it. */
  durable: boolean;
  timer: ReturnType<typeof setTimeout>;
  committing: boolean;
  /** Undo has started; a late toast close must not commit. */
  undoing: boolean;
  /**
   * Another live tab is committing this deletion: the card stays hidden until it finishes,
   * and this tab takes the deletion over if that tab's claim goes stale.
   */
  watching?: () => void;
  onError: () => void;
  /** Called once when the DELETE starts, so an Undo toast can be dismissed. */
  onStart?: () => void;
}
const same = (a: Tombstone, b: Tombstone) =>
  a.url === b.url && a.etag === b.etag && a.deleteAt === b.deleteAt;

const validClaim = (claim: unknown): claim is NonNullable<Tombstone["claim"]> =>
  typeof (claim as { by?: unknown })?.by === "string" &&
  Number.isFinite((claim as { at?: unknown }).at);
/** Pending deletions keyed by account and storage; unavailable storage reads as empty. */
function tombstoneQueue(session: HomeSession) {
  const key = `suite.home.pending-deletes:${session.webId}\u0000${session.storageUrl}`;
  const read = (): Tombstone[] => {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is Tombstone =>
          typeof entry?.url === "string" &&
          typeof entry.etag === "string" &&
          Number.isFinite(entry.deleteAt),
      )
      .map(({ url, etag, deleteAt, claim, undone }) => ({
        url,
        etag,
        deleteAt,
        ...(validClaim(claim) ? { claim: { by: claim.by, at: claim.at } } : {}),
        ...(undone === true ? { undone } : {}),
      }));
  };
  const entries = (): Tombstone[] | undefined => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  /**
   * Run `work` while holding this queue's exclusive Web Lock, so no other tab of this origin
   * reads or writes the queue meanwhile. `work` must be synchronous: the lock is released as
   * soon as it returns. Without `navigator.locks` it runs at once, unguarded.
   */
  const exclusive = <T>(work: () => T): Promise<T> => {
    const locks = (globalThis as { navigator?: Navigator }).navigator?.locks;
    if (typeof locks?.request !== "function") return new Promise<T>((resolve) => resolve(work()));
    return locks.request(key, { mode: "exclusive" }, () => work()) as Promise<T>;
  };
  /**
   * A read-modify-write under the queue's Web Lock, so tabs never interleave their updates.
   * Without `navigator.locks` it is a single synchronous read-modify-write, which another
   * tab (in its own process) can still interleave with. Undefined when browser storage or the
   * lock is unavailable.
   */
  const transact = async <T>(
    change: (entries: Tombstone[]) => { next: Tombstone[]; result: T },
  ): Promise<T | undefined> => {
    try {
      return await exclusive(() => {
        const { next, result } = change(read());
        if (next.length) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
        return result;
      });
    } catch {
      return undefined;
    }
  };
  return {
    key,
    entries,
    exclusive,
    transact,
    /** Read-modify-write so another tab's tombstones are kept. */
    async update(change: (entries: Tombstone[]) => Tombstone[]): Promise<boolean> {
      return (await transact((entries) => ({ next: change(entries), result: true }))) ?? false;
    },
  };
}

/**
 * Session-scoped tombstones fence live/focus refreshes. They are also kept in
 * browser storage for this account, so a reload or closed tab during the undo
 * window finishes the deletion on the next load instead of silently cancelling it.
 * `offerTakeover` is told when this page takes over a deletion that another tab claimed
 * and then abandoned (it closed mid-commit), so it can offer Undo for it again.
 */
export function createDeleteController(
  session: HomeSession,
  refresh: () => Promise<void>,
  resumedError: () => void = () => {},
  offerTakeover: (url: string, deleteAt: number) => void = () => {},
) {
  let hidden: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const reading = new Set<string>();
  const pending = new Map<string, PendingDelete>();
  const queue = tombstoneQueue(session);
  const profileUrl = session.webId.split("#")[0] as string;
  const publish = (url: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(url);
    else next.delete(url);
    hidden = next;
    for (const listener of listeners) listener();
  };
  /** Identifies this page's claims in the shared queue. */
  const owner = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  /** Another live tab is committing this tombstone. */
  const claimedElsewhere = (tombstone: Tombstone) =>
    tombstone.claim !== undefined &&
    tombstone.claim.by !== owner &&
    Date.now() - tombstone.claim.at < CLAIM_STALE_MS;
  /** Re-checks to run when another tab changes the queue (each also has its own timer). */
  const wakers = new Set<() => void>();
  const onStorage = (event: Event) => {
    const changed = (event as StorageEvent).key;
    if (changed !== null && changed !== queue.key) return;
    for (const wake of [...wakers]) wake();
  };
  const events = typeof globalThis.addEventListener === "function" ? globalThis : undefined;
  events?.addEventListener("storage", onStorage);
  const stopWatching = (entry: PendingDelete) => {
    if (!entry.watching) return;
    wakers.delete(entry.watching);
    delete entry.watching;
  };
  const forget = async (entry: PendingDelete) => {
    const { url } = entry.tombstone;
    stopWatching(entry);
    if (pending.get(url) === entry) pending.delete(url);
    // Leave a tombstone another tab is committing: its Undo must keep saying "too late".
    await queue.update((entries) =>
      entries.filter((other) => !same(other, entry.tombstone) || claimedElsewhere(other)),
    );
    if (!pending.has(url)) publish(url, false);
  };
  /**
   * The HEAD status of the item, or undefined when the server can't be asked. 404 means it
   * is gone (another tab finished this deletion); 2xx means it exists.
   */
  const status = (url: string) =>
    session.fetch(url, { method: "HEAD", redirect: "error" }).then(
      (response) => response.status,
      () => undefined,
    );
  const gone = async (url: string) => (await status(url)) === 404;
  const exists = (found: number | undefined) => found !== undefined && found >= 200 && found < 300;
  /**
   * Atomically take the shared tombstone: "ours" once this tab holds it, "missing" when
   * another tab already undid or finished the deletion, "taken" while another tab commits it.
   * `withdraw` removes it (Undo); `claim` marks it as claimed by this tab (commit). An Undo
   * that holds the saved copy marks a taken tombstone `undone`, so its committer, which
   * re-checks its claim right before the DELETE, sends none.
   * Without browser storage this page can only act alone, so the answer is "ours".
   */
  const take = async (
    entry: PendingDelete,
    action: "claim" | "withdraw",
  ): Promise<"ours" | "missing" | "taken"> => {
    if (!entry.durable) return "ours";
    return (
      (await queue.transact((entries) => {
        const index = entries.findIndex((other) => same(other, entry.tombstone));
        const found = entries[index];
        if (!found || (action === "claim" && found.undone))
          return { next: entries, result: "missing" as const };
        const next = [...entries];
        if (claimedElsewhere(found)) {
          if (action === "withdraw" && entry.restore) next[index] = { ...found, undone: true };
          return { next, result: "taken" as const };
        }
        if (action === "withdraw") next.splice(index, 1);
        else next[index] = { ...found, claim: { by: owner, at: Date.now() } };
        return { next, result: "ours" as const };
      })) ?? "ours"
    );
  };
  /**
   * Resolves once no other live tab claims `tombstone`: it finished (or abandoned) the
   * deletion, or its claim went stale. Woken by storage events, and polled as well.
   */
  const claimCleared = (tombstone: Tombstone) =>
    new Promise<void>((resolve) => {
      const deadline = Date.now() + CLAIM_STALE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        clearTimeout(timer);
        const found = queue.entries()?.find((other) => same(other, tombstone));
        if (!found || !claimedElsewhere(found) || Date.now() >= deadline) {
          wakers.delete(check);
          resolve();
        } else timer = setTimeout(check, CLAIM_POLL_MS);
      };
      wakers.add(check);
      check();
    });
  /**
   * Another live tab claimed this deletion: keep the card hidden while it commits, and
   * look again when the queue changes or that claim would go stale.
   */
  const watch = (entry: PendingDelete) => {
    entry.committing = false;
    const check = () => {
      if (entry.watching !== check) return;
      clearTimeout(entry.timer);
      const found = queue.entries()?.find((other) => same(other, entry.tombstone));
      if (found?.claim && !found.undone && claimedElsewhere(found)) {
        entry.timer = setTimeout(check, found.claim.at + CLAIM_STALE_MS - Date.now());
        return;
      }
      stopWatching(entry);
      void takeOver(entry).catch(() => {
        entry.onError();
        return forget(entry);
      });
    };
    entry.watching = check;
    wakers.add(check);
    check();
  };
  /**
   * Settle a watched deletion. When the other tab finished it, or it was undone, the card
   * follows the refreshed pod. When that tab's claim went stale (it closed mid-commit, so
   * its DELETE may never have been sent), this tab takes the deletion over as its own
   * pending one, with a fresh undo window and Undo offered again. Another tab's newer
   * tombstone for the same item is adopted the same way, or watched while it is claimed.
   */
  const takeOver = async (entry: PendingDelete) => {
    const { url, etag } = entry.tombstone;
    const current = await queue.transact((entries) => {
      const found =
        entries.find((other) => same(other, entry.tombstone)) ??
        entries.find((other) => other.url === url);
      if (!found || found.undone) return { next: entries, result: undefined };
      if (claimedElsewhere(found) || !same(found, entry.tombstone))
        return { next: entries, result: found };
      const fresh: Tombstone = { url, etag, deleteAt: Date.now() + UNDO_MS };
      // Before the lock is released, so an Undo queued behind it withdraws the fresh one.
      entry.tombstone = fresh;
      return { next: entries.map((other) => (other === found ? fresh : other)), result: fresh };
    });
    if (pending.get(url) !== entry || entry.undoing || entry.committing) return;
    if (!current) {
      await refresh();
      await forget(entry);
      return;
    }
    entry.tombstone = current;
    if (claimedElsewhere(current)) {
      watch(entry);
      return;
    }
    delete entry.onStart;
    entry.timer = setTimeout(() => start(entry), Math.max(0, current.deleteAt - Date.now()));
    offerTakeover(url, current.deleteAt);
  };
  const commit = async (
    entry: PendingDelete,
    resumed: boolean,
  ): Promise<"watching" | undefined> => {
    const { url, etag } = entry.tombstone;
    // Claim the deletion first, so Undo in another tab can no longer report success for it.
    // While another tab is committing it, keep the card hidden until that tab is done; when
    // another tab already undid or finished it, only refresh, so the card follows the pod.
    const taken = await take(entry, "claim");
    if (taken === "taken") {
      watch(entry);
      return "watching";
    }
    if (taken === "missing") {
      await refresh();
      return;
    }
    if (resumed) {
      // Re-check protection: browser storage is not a trusted source of targets.
      let read: Awaited<ReturnType<typeof readItem>>;
      try {
        read = await readItem(session, url);
      } catch (error) {
        // Another tab already finished it: that is the outcome this tombstone asked for.
        if (error instanceof ItemReadError && error.status === 404) {
          await refresh();
          return;
        }
        throw error;
      }
      if (
        isContainer(read.item) ||
        protectedDocument(read.item, session.storageUrl, session.webId) ||
        (await linkedProtectedDocument(session, url))
      )
        throw new Error("This item can't be deleted");
    }
    const send = () =>
      session.fetch(url, { method: "DELETE", redirect: "error", headers: { "if-match": etag } });
    // Re-check the claim and send the DELETE under the queue's lock: a claim that went stale
    // meanwhile may have been taken over, or an Undo holding the copy may have marked it
    // undone. Unreadable storage can't show otherwise. The response is awaited outside it.
    const sent = entry.durable
      ? await queue.exclusive(() => {
          const queued = queue.entries();
          const holds =
            !queued ||
            queued.some(
              (other) => same(other, entry.tombstone) && other.claim?.by === owner && !other.undone,
            );
          return holds ? { response: send() } : undefined;
        })
      : { response: send() };
    if (!sent) {
      await refresh();
      return;
    }
    const response = await sent.response;
    // 412 with the item missing means it was deleted elsewhere meanwhile: also success.
    if (!response.ok && response.status !== 404 && !(response.status === 412 && (await gone(url))))
      throw new Error("Delete failed");
    await refresh();
  };
  /** Start the DELETE now (once), unless Undo has started or another tab is committing it. */
  const start = (entry: PendingDelete) => {
    if (entry.committing || entry.undoing || entry.watching) return;
    clearTimeout(entry.timer);
    entry.committing = true;
    entry.onStart?.();
    void commit(entry, !entry.restore).then(
      (outcome) => (outcome === "watching" ? undefined : forget(entry)),
      () => {
        entry.onError();
        return forget(entry);
      },
    );
  };
  const schedule = (
    tombstone: Tombstone,
    onError: () => void,
    restore?: PendingDelete["restore"],
  ): PendingDelete => {
    const entry: PendingDelete = {
      tombstone,
      ...(restore ? { restore } : {}),
      durable: !restore,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      committing: false,
      undoing: false,
      onError,
    };
    pending.set(tombstone.url, entry);
    publish(tombstone.url, true);
    entry.timer = setTimeout(() => start(entry), Math.max(0, tombstone.deleteAt - Date.now()));
    return entry;
  };
  if (typeof localStorage !== "undefined")
    for (const tombstone of queue.entries() ?? []) {
      // An Undo in another tab is restoring this one.
      if (tombstone.undone) continue;
      try {
        const url = assertWithinPodScope(session.storageUrl, tombstone.url);
        if (url !== tombstone.url || url === profileUrl || pending.has(url)) continue;
      } catch {
        continue;
      }
      schedule(tombstone, resumedError);
    }
  return {
    getSnapshot: () => hidden,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async remove(item: DomainItem, onError: () => void): Promise<boolean> {
      if (
        pending.has(item.url) ||
        reading.has(item.url) ||
        isContainer(item) ||
        protectedDocument(item, session.storageUrl, session.webId)
      )
        return false;
      reading.add(item.url);
      try {
        const read = await readItem(session, item.url, item.subject);
        if (
          !read.writable ||
          isContainer(read.item) ||
          !read.item.etag ||
          protectedDocument(read.item, session.storageUrl, session.webId) ||
          (await linkedProtectedDocument(session, item.url))
        )
          return false;
        const target = assertWithinPodScope(session.storageUrl, item.url);
        const tombstone = { url: target, etag: read.item.etag, deleteAt: Date.now() + UNDO_MS };
        const entry = schedule(tombstone, onError, {
          body: read.body,
          contentType: read.contentType,
        });
        // Without browser storage the deletion still runs from this page's timer.
        entry.durable = await queue.update((entries) => [
          ...entries.filter((other) => other.url !== target),
          tombstone,
        ]);
        return true;
      } finally {
        reading.delete(item.url);
      }
    },
    /** Deletions waiting for their undo window: those resumed from an earlier page have no copy. */
    pendingDeletes(): { url: string; deleteAt: number; resumed: boolean }[] {
      return [...pending.values()]
        .filter((entry) => !entry.committing && !entry.undoing && !entry.watching)
        .map((entry) => ({
          url: entry.tombstone.url,
          deleteAt: entry.tombstone.deleteAt,
          resumed: !entry.restore,
        }));
    },
    /**
     * Let a UI element (an Undo toast) decide when the deletion runs: this page's timer
     * waits {@link HOLD_GRACE_MS} past the undo window, and the holder calls `release`
     * when it closes. `onStart` runs when the DELETE starts, however it was started.
     */
    hold(url: string, onStart?: () => void): boolean {
      const entry = pending.get(url);
      if (!entry || entry.committing || entry.undoing || entry.watching) return false;
      clearTimeout(entry.timer);
      if (onStart) entry.onStart = onStart;
      entry.timer = setTimeout(
        () => start(entry),
        Math.max(0, entry.tombstone.deleteAt - Date.now()) + HOLD_GRACE_MS,
      );
      return true;
    },
    /** The holder closed without Undo: delete now. */
    release(url: string): void {
      const entry = pending.get(url);
      if (entry) start(entry);
    },
    async undo(url: string): Promise<boolean> {
      const entry = pending.get(url);
      if (!entry || entry.committing || entry.undoing) return false;
      entry.undoing = true;
      stopWatching(entry);
      clearTimeout(entry.timer);
      let watching = false;
      try {
        // Withdraw the shared tombstone before anything else, so no other tab starts its DELETE
        // afterwards. A tab already committing it holds a claim.
        const taken = await take(entry, "withdraw");
        if (!entry.restore) {
          // A resumed entry has no copy, so withdrawing its tombstone is the undo, but only
          // while the deletion is still pending. Too late while another tab commits it: the
          // card then stays hidden until that tab is done.
          if (taken === "taken") {
            entry.undoing = false;
            watching = true;
            watch(entry);
            return false;
          }
          const found = await status(url);
          const undone =
            taken === "ours"
              ? // A DELETE that finished just before a reload leaves its tombstone behind. An
                // unreachable server can't show the item is gone; withdrawing is then still safe.
                found !== 404
              : // Another tab removed the tombstone: it undid the deletion when the item is
                // still there, or finished it. Unknown is reported as too late.
                exists(found);
          await refresh();
          return undone;
        }
        const { body, contentType } = entry.restore;
        const put = (condition: Record<string, string>) =>
          session.fetch(url, {
            method: "PUT",
            redirect: "error",
            headers: { "content-type": contentType, ...condition },
            body,
          });
        const settle = (response: Response) => {
          if (!response.ok && response.status !== 412) throw new Error("Restore failed");
          return response.ok;
        };
        if (taken === "taken") {
          // Another live tab is committing it. `take` marked the tombstone undone, so that tab
          // sends no DELETE if it hasn't yet; it may already have, and an If-Match rewrite
          // can't stop that DELETE where ETags only follow content. So wait until that tab is
          // done (or its claim goes stale), then put the copy back only where nothing is now,
          // and only report success once the item is confirmed to be there.
          await claimCleared(entry.tombstone);
          settle(await put({ "if-none-match": "*" }));
          if (!exists(await status(url))) throw new Error("Restore failed");
          await refresh();
          return true;
        }
        // Normally the delayed DELETE has not run. The create-only PUT also safely restores a
        // resource removed elsewhere during the undo window, without overwriting a new one.
        // While the original is still in place, re-write it only while its captured validator
        // still matches, so Undo has a fresh version without replacing a concurrent edit. A
        // DELETE (from another tab) can land between the two: then create it once more.
        const written =
          settle(await put({ "if-none-match": "*" })) ||
          settle(await put({ "if-match": entry.tombstone.etag })) ||
          settle(await put({ "if-none-match": "*" }));
        // Every write was refused: a newer item is in place (Undo then leaves it), or the
        // restore didn't happen.
        if (!written && !exists(await status(url))) throw new Error("Restore failed");
        await refresh();
        return true;
      } finally {
        if (!watching) await forget(entry);
      }
    },
    /** Stop this page's timers while keeping the durable queue for the next load. */
    dispose() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      events?.removeEventListener("storage", onStorage);
    },
  };
}
