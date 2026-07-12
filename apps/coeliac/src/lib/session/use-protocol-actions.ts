// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The elimination-protocol actions the UI calls — optimistic + non-blocking (UX
 * invariant #2), exactly like `useDiaryActions`. Starting or advancing a protocol
 * writes the new FSM state to the durable cache FIRST (instant), then returns a
 * `syncing` promise that resolves when the pod write completes. On a failed write
 * the record is marked `error` and retried by the outbox reconcile.
 *
 * The HEALTH-SAFETY RAILS live in the pure FSM ({@link startProtocol} /
 * {@link advanceProtocol}) — this hook NEVER bypasses them: a refusal / rejection is
 * surfaced to the caller unchanged and NOTHING is written. When a protocol reaches
 * `concluded`, the observed verdict is turned into a `confirmed` tolerance conclusion
 * via {@link deriveConfirmedConclusion} (the sole `confirmed` path) and persisted too.
 */
import { useCallback } from "react";
import type { StoredConclusion, StoredProtocol } from "../cache/diary-store";
import { syncConclusion, syncProtocol } from "../diary/sync";
import { deriveConfirmedConclusion } from "../inference/conclude";
import {
  advanceProtocol,
  type ProtocolEvent,
  type ProtocolOptions,
  type ProtocolSafetyContext,
  startProtocol,
  type StartProtocolInput,
} from "../protocol/fsm";
import { newConclusionRecord, newProtocolRecord, storedProtocolToData, updateProtocolRecord } from "../protocol/persist";
import { NotSignedInError } from "./use-diary-actions";
import { useSession } from "./context";

/** The result of a protocol mutation: the updated record + a settle-when-synced promise. */
export interface ProtocolActionResult {
  protocol: StoredProtocol;
  /** The conclusion minted if this action concluded the protocol (else undefined). */
  conclusion?: StoredConclusion;
  syncing: Promise<void>;
}

/** A refused start (a health-safety rail or an in-progress challenge) — nothing written. */
export interface StartRefused {
  refused: true;
  kind: string;
  message: string;
}

/** A rejected advance (invalid transition / fail-closed) — nothing written. */
export interface AdvanceRejected {
  rejected: true;
  kind: string;
  message: string;
}

export function useProtocolActions() {
  const { store, storageRoot, webId, authedFetch } = useSession();

  const requireCtx = useCallback(() => {
    if (!store || !storageRoot || !webId) throw new NotSignedInError();
    return { store, storageRoot, webId, authedFetch };
  }, [store, storageRoot, webId, authedFetch]);

  /**
   * Start a challenge for a trigger (the one-tap "start an elimination challenge for
   * X"). Returns a {@link StartRefused} — writing NOTHING — when the FSM refuses
   * (gluten / emergency trigger / another challenge in progress). Existing protocols
   * are read from the cache so the one-variable guard sees them.
   */
  const startChallenge = useCallback(
    async (
      input: Omit<StartProtocolInput, "existingProtocols">,
      safety: ProtocolSafetyContext = {},
      now: Date = new Date(),
    ): Promise<ProtocolActionResult | StartRefused> => {
      const ctx = requireCtx();
      const existing = await ctx.store.allProtocols();
      const existingData = existing.map(storedProtocolToData);
      const result = startProtocol(
        { ...input, patient: input.patient ?? ctx.webId, existingProtocols: existingData },
        safety,
        now,
      );
      if (!result.ok) {
        return { refused: true, kind: result.refusal.kind, message: result.refusal.message };
      }
      const record = newProtocolRecord(result.protocol, ctx.storageRoot, now);
      await ctx.store.putProtocol(record);
      const syncing = flushProtocol(ctx, record);
      return { protocol: record, syncing };
    },
    [requireCtx],
  );

  /**
   * Apply an event to a cached protocol. Returns an {@link AdvanceRejected} (writing
   * NOTHING) when the FSM rejects the transition (fail-closed). When the protocol
   * concludes, the observed verdict is turned into a `confirmed` conclusion and
   * persisted alongside the concluded protocol.
   */
  const advanceChallenge = useCallback(
    async (
      protocol: StoredProtocol,
      event: ProtocolEvent,
      safety: ProtocolSafetyContext = {},
      now: Date = new Date(),
    ): Promise<ProtocolActionResult | AdvanceRejected> => {
      const ctx = requireCtx();
      // Feed the FSM the OTHER protocols so the reintroduce-edge one-variable guard fires.
      const others = (await ctx.store.allProtocols())
        .filter((p) => p.ulid !== protocol.ulid)
        .map(storedProtocolToData);
      const options: ProtocolOptions = { otherProtocols: others };
      const result = advanceProtocol(storedProtocolToData(protocol), event, now, safety, options);
      if (result.rejection) {
        return { rejected: true, kind: result.rejection.kind, message: result.rejection.message };
      }
      const updated = updateProtocolRecord(protocol, result.protocol, now);
      await ctx.store.putProtocol(updated);

      // Concluded ⇒ mint + persist the confirmed conclusion (the sole confirmed path).
      let conclusionRecord: StoredConclusion | undefined;
      if (result.protocol.phase === "concluded" && result.verdict) {
        const conclusionData = deriveConfirmedConclusion(result.protocol, result.verdict, {
          now,
          patient: ctx.webId,
        });
        if (conclusionData) {
          conclusionRecord = newConclusionRecord(conclusionData, ctx.storageRoot, updated.ulid, now);
          await ctx.store.putConclusion(conclusionRecord);
        }
      }

      const syncing = (async () => {
        await flushProtocol(ctx, updated);
        if (conclusionRecord) await flushConclusion(ctx, conclusionRecord);
      })();
      return { protocol: updated, conclusion: conclusionRecord, syncing };
    },
    [requireCtx],
  );

  return { startChallenge, advanceChallenge };
}

// --- pod flush helpers (optimistic; failure marks the record `error`) ---------

type Ctx = {
  store: NonNullable<ReturnType<typeof useSession>["store"]>;
  storageRoot: string;
  webId: string;
  authedFetch: typeof globalThis.fetch;
};

async function flushProtocol(ctx: Ctx, record: StoredProtocol): Promise<void> {
  try {
    await syncProtocol(
      { authedFetch: ctx.authedFetch, webId: ctx.webId, storageRoot: ctx.storageRoot },
      record,
    );
    await ctx.store.markProtocolSync(record.ulid, "synced");
  } catch (err) {
    await ctx.store.markProtocolSync(record.ulid, "error", (err as Error).message);
    throw err;
  }
}

async function flushConclusion(ctx: Ctx, record: StoredConclusion): Promise<void> {
  try {
    await syncConclusion(
      { authedFetch: ctx.authedFetch, webId: ctx.webId, storageRoot: ctx.storageRoot },
      record,
    );
    await ctx.store.markConclusionSync(record.ulid, "synced");
  } catch (err) {
    await ctx.store.markConclusionSync(record.ulid, "error", (err as Error).message);
    throw err;
  }
}
