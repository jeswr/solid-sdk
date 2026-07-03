// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Flush the optimistic outbox to the pod (UX invariant #2 — writes persist
 * asynchronously; the cache is the source of truth for the UI). Each pending
 * record is serialised via `@jeswr/solid-health-diary` and PUT under the
 * ACL-protected diary root; success flips it to `synced`, a failure to `error`
 * (retried next flush). ALL writes go through the injected authed fetch; the diary
 * root's owner-only ACL is ensured (written first) before any resource write.
 */
import {
  serializeMeal,
  serializeProtocol,
  serializeSymptom,
  serializeToleranceConclusion,
} from "@jeswr/solid-health-diary";
import type {
  DiaryStore,
  StoredConclusion,
  StoredMeal,
  StoredProtocol,
  StoredSymptom,
} from "../cache/diary-store.js";
import { ensureDiaryReady, putResource } from "../pod/pod-fs.js";
import { storedConclusionToData, storedProtocolToData } from "../protocol/persist.js";

/** The authed context a flush needs. */
export interface SyncContext {
  authedFetch: typeof globalThis.fetch;
  webId: string;
  storageRoot: string;
}

/** Serialise + PUT one meal to the pod (ACL ensured first). */
export async function syncMeal(ctx: SyncContext, meal: StoredMeal): Promise<void> {
  await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
  const body = await serializeMeal(meal.url, {
    startTime: new Date(meal.startTime),
    created: new Date(meal.createdAt),
    context: meal.context,
    portion: meal.portion,
    venue: meal.venue,
    note: meal.note,
    patient: ctx.webId,
    items: meal.items,
    exposures: meal.exposures,
  });
  await putResource(ctx.authedFetch, meal.url, body);
}

/** Serialise + PUT one symptom to the pod (ACL ensured first). */
export async function syncSymptom(ctx: SyncContext, symptom: StoredSymptom): Promise<void> {
  await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
  const body = await serializeSymptom(symptom.url, {
    symptomType: symptom.symptomType,
    onset: new Date(symptom.onset),
    created: new Date(symptom.createdAt),
    severity: symptom.severity,
    note: symptom.note,
    patient: ctx.webId,
  });
  await putResource(ctx.authedFetch, symptom.url, body);
}

/** Serialise + PUT one elimination protocol to the pod (ACL ensured first). */
export async function syncProtocol(ctx: SyncContext, protocol: StoredProtocol): Promise<void> {
  await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
  const data = storedProtocolToData(protocol);
  const body = await serializeProtocol(protocol.url, { ...data, patient: data.patient ?? ctx.webId });
  await putResource(ctx.authedFetch, protocol.url, body);
}

/** Serialise + PUT one tolerance conclusion to the pod (ACL ensured first). */
export async function syncConclusion(ctx: SyncContext, conclusion: StoredConclusion): Promise<void> {
  await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
  const data = storedConclusionToData(conclusion);
  const body = await serializeToleranceConclusion(conclusion.url, {
    ...data,
    patient: data.patient ?? ctx.webId,
  });
  await putResource(ctx.authedFetch, conclusion.url, body);
}

/** The outcome of a flush pass. */
export interface FlushResult {
  synced: number;
  failed: number;
}

/**
 * Flush every pending/errored record to the pod, updating each record's sync
 * state in the store. Never throws — a per-record failure marks that record
 * `error` and the flush continues (offline-tolerant; retried next pass).
 */
export async function flushOutbox(ctx: SyncContext, store: DiaryStore): Promise<FlushResult> {
  const { meals, symptoms, protocols, conclusions } = await store.pending();
  let synced = 0;
  let failed = 0;
  for (const meal of meals) {
    try {
      await syncMeal(ctx, meal);
      await store.markMealSync(meal.ulid, "synced");
      synced += 1;
    } catch (err) {
      await store.markMealSync(meal.ulid, "error", (err as Error).message);
      failed += 1;
    }
  }
  for (const symptom of symptoms) {
    try {
      await syncSymptom(ctx, symptom);
      await store.markSymptomSync(symptom.ulid, "synced");
      synced += 1;
    } catch (err) {
      await store.markSymptomSync(symptom.ulid, "error", (err as Error).message);
      failed += 1;
    }
  }
  for (const protocol of protocols) {
    try {
      await syncProtocol(ctx, protocol);
      await store.markProtocolSync(protocol.ulid, "synced");
      synced += 1;
    } catch (err) {
      await store.markProtocolSync(protocol.ulid, "error", (err as Error).message);
      failed += 1;
    }
  }
  for (const conclusion of conclusions) {
    try {
      await syncConclusion(ctx, conclusion);
      await store.markConclusionSync(conclusion.ulid, "synced");
      synced += 1;
    } catch (err) {
      await store.markConclusionSync(conclusion.ulid, "error", (err as Error).message);
      failed += 1;
    }
  }
  return { synced, failed };
}
