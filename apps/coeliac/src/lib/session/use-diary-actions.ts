// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The logging actions the UI calls — optimistic + non-blocking (UX invariant #2).
 * Each action writes the record to the durable cache FIRST (instant), then returns
 * a `syncing` promise that resolves when the pod write completes (drives the
 * "Saving…/Saved" indicator). A failed write marks the record `error` in the cache
 * and is retried by the outbox reconcile on reconnect — the log is never lost.
 */
import { useCallback } from "react";
import type { StoredMeal, StoredSymptom } from "../cache/diary-store.js";
import { type NewMealInput, type NewSymptomInput, cloneForRelog, newMealRecord, newSymptomRecord } from "../diary/log.js";
import { syncMeal, syncSymptom } from "../diary/sync.js";
import { useSession } from "./context.js";

/** A record written optimistically, with a promise that settles when it syncs. */
export interface LogResult<T> {
  record: T;
  syncing: Promise<void>;
}

/** Thrown when an action is invoked without an authenticated session. */
export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in — cannot log to the pod.");
    this.name = "NotSignedInError";
  }
}

export function useDiaryActions() {
  const { store, storageRoot, webId, authedFetch } = useSession();

  const requireCtx = useCallback(() => {
    if (!store || !storageRoot || !webId) throw new NotSignedInError();
    return { store, storageRoot, webId, authedFetch };
  }, [store, storageRoot, webId, authedFetch]);

  const logMeal = useCallback(
    async (input: Omit<NewMealInput, "storageRoot">): Promise<LogResult<StoredMeal>> => {
      const ctx = requireCtx();
      const record = newMealRecord({ ...input, storageRoot: ctx.storageRoot });
      await ctx.store.putMeal(record);
      const syncing = (async () => {
        try {
          await syncMeal({ authedFetch: ctx.authedFetch, webId: ctx.webId, storageRoot: ctx.storageRoot }, record);
          await ctx.store.markMealSync(record.ulid, "synced");
        } catch (err) {
          await ctx.store.markMealSync(record.ulid, "error", (err as Error).message);
          throw err;
        }
      })();
      return { record, syncing };
    },
    [requireCtx],
  );

  const relogMeal = useCallback(
    async (meal: StoredMeal): Promise<LogResult<StoredMeal>> => {
      const ctx = requireCtx();
      const record = cloneForRelog(meal, ctx.storageRoot);
      await ctx.store.putMeal(record);
      const syncing = (async () => {
        try {
          await syncMeal({ authedFetch: ctx.authedFetch, webId: ctx.webId, storageRoot: ctx.storageRoot }, record);
          await ctx.store.markMealSync(record.ulid, "synced");
        } catch (err) {
          await ctx.store.markMealSync(record.ulid, "error", (err as Error).message);
          throw err;
        }
      })();
      return { record, syncing };
    },
    [requireCtx],
  );

  const logSymptom = useCallback(
    async (input: Omit<NewSymptomInput, "storageRoot">): Promise<LogResult<StoredSymptom>> => {
      const ctx = requireCtx();
      const record = newSymptomRecord({ ...input, storageRoot: ctx.storageRoot });
      await ctx.store.putSymptom(record);
      const syncing = (async () => {
        try {
          await syncSymptom({ authedFetch: ctx.authedFetch, webId: ctx.webId, storageRoot: ctx.storageRoot }, record);
          await ctx.store.markSymptomSync(record.ulid, "synced");
        } catch (err) {
          await ctx.store.markSymptomSync(record.ulid, "error", (err as Error).message);
          throw err;
        }
      })();
      return { record, syncing };
    },
    [requireCtx],
  );

  return { logMeal, relogMeal, logSymptom };
}
