// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The genetics actions the UI calls (Phase 3c). PRIVACY-CRITICAL. Two entry paths —
 * manual haplotype selection and an on-device file parse — both produce an
 * interpreted PREVIEW (no consent yet, nothing written) that the view renders behind
 * the explicit consent gate; only {@link GeneticsActions.save} (which REQUIRES an
 * affirmative consent argument) writes anything.
 *
 * **The load-bearing privacy invariant lives in `buildFilePreview`:** the raw file
 * is read with `FileReader` into a local `string`, parsed + interpreted on-device
 * (`parse.ts`/`interpret.ts` — pure, no I/O), and the string is then out of scope.
 * ONLY the derived {@link GeneticPreview} (interpreted marker rows + framing) is
 * returned; the raw genome text is never returned, cached, or sent to any fetch. A
 * test drives this path with a stubbed fetch and asserts no request body ever
 * contains the raw genotype content.
 *
 * Writes are optimistic + offline-tolerant (UX invariants #2/#3): a saved summary
 * lands in the durable cache FIRST (instant), then flushes to the pod; a failed
 * flush marks it `error` and the outbox retries it (`flushOutbox`).
 */
import type { GeneticSummaryData, MarkerPresence, RiskHaplotype } from "@jeswr/solid-health-diary";
import { useCallback, useEffect, useState } from "react";
import { ulid } from "ulid";
import type { StoredGeneticSummary } from "../cache/diary-store.js";
import { syncGeneticSummary } from "../diary/sync.js";
import {
  buildSummaryData,
  interpretClinical,
  interpretConsumerArray,
  type SummarySource,
} from "../genetics/interpret.js";
import { markerFromManual } from "../genetics/interpret.js";
import { parseClinicalText, parseConsumerArray } from "../genetics/parse.js";
import { readGeneticSummary } from "../genetics/summary.js";
import { geneticsSummaryUrl } from "../pod/layout.js";
import { NotSignedInError } from "./use-diary-actions.js";
import { useSession } from "./context.js";

/** An interpreted, pre-consent preview of what WOULD be stored (never raw bytes). */
export type GeneticPreview = Omit<GeneticSummaryData, "consentGiven" | "id"> & {
  source: SummarySource;
};

/** Thrown when a save is attempted without affirmative consent — nothing is written. */
export class ConsentRequiredError extends Error {
  constructor() {
    super("Genetic data cannot be saved without explicit consent.");
    this.name = "ConsentRequiredError";
  }
}

export interface GeneticsState {
  /** The cached summary (instant, offline), or undefined if none stored. */
  summary?: StoredGeneticSummary;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export interface GeneticsActions {
  /** Build a preview from manual present/absent/uncertain selections (nothing written). */
  buildManualPreview: (
    selections: Partial<Record<RiskHaplotype, MarkerPresence>>,
    patient?: string,
  ) => GeneticPreview;
  /**
   * Read + parse a genetic file **entirely on-device** and return the interpreted
   * preview. The raw file bytes never leave this function (never returned, cached,
   * or sent anywhere). Chooses the consumer-array parser when the file yields tag
   * SNP rows, else falls back to the best-effort clinical-text scan.
   */
  buildFilePreview: (file: File, patient?: string) => Promise<GeneticPreview>;
  /**
   * Persist a preview — REQUIRES `consentGiven === true` (throws
   * {@link ConsentRequiredError} otherwise, writing nothing). Optimistic: caches
   * first, then flushes to the pod. Returns a promise that settles when the pod
   * write completes (or rejects on a flush failure — the record is left `pending`
   * for the outbox to retry).
   */
  save: (
    preview: GeneticPreview,
    consentGiven: boolean,
  ) => Promise<{ summary: StoredGeneticSummary; syncing: Promise<void> }>;
}

/** Read the file as text in the browser (the ONLY place the raw genome string exists). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export function useGenetics(): GeneticsState & GeneticsActions {
  const { status, store, storageRoot, webId, authedFetch } = useSession();
  const [summary, setSummary] = useState<StoredGeneticSummary | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!store) {
      setSummary(undefined);
      setLoaded(true);
      return;
    }
    // Instant paint from the durable cache first (UX invariant #3).
    const cached = await store.getGeneticSummary();
    setSummary(cached);
    setLoaded(true);
    // Cross-session hydration: if the cache is empty but a summary exists on the
    // pod (a prior session on another device), pull it down and cache it as synced.
    // Gated on a FULLY-authed session (never fire a remote read with a half-wired or
    // just-signed-out `authedFetch`). Fail-safe — a 404 / offline yields undefined
    // and leaves the empty state.
    if (!cached && status === "authed" && storageRoot && webId) {
      const remote = await readGeneticSummary({ authedFetch, webId, storageRoot });
      // Re-check the cache AFTER the async read: if the user saved a new local
      // summary while the read was in flight, do NOT overwrite it with the older
      // remote record — hydrate only if the cache is STILL empty.
      const stillEmpty = !(await store.getGeneticSummary());
      if (remote && stillEmpty) {
        const record: StoredGeneticSummary = {
          kind: "genetic",
          url: geneticsSummaryUrl(storageRoot),
          markers: remote.markers,
          interpretation: remote.interpretation,
          coeliacGeneticRisk: remote.coeliacGeneticRisk,
          coverageComplete: remote.coverageComplete,
          sourceType: remote.sourceType,
          consentGiven: true,
          createdAt: (remote.created ?? new Date()).toISOString(),
          rev: ulid(),
          sync: "synced",
        };
        await store.putGeneticSummary(record);
        setSummary(record);
      }
    }
  }, [status, store, storageRoot, webId, authedFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildManualPreview = useCallback(
    (
      selections: Partial<Record<RiskHaplotype, MarkerPresence>>,
      patient?: string,
    ): GeneticPreview => {
      // A haplotype the user left UNKNOWN yields NO marker (never a false absent).
      const markers = (Object.entries(selections) as [RiskHaplotype, MarkerPresence][])
        .filter(([, presence]) => presence !== undefined)
        .map(([haplotype, presence]) => markerFromManual(haplotype, presence));
      const data = buildSummaryData(markers, "manual", patient ?? webId ?? undefined);
      return { ...data, source: "manual" };
    },
    [webId],
  );

  const buildFilePreview = useCallback(
    async (file: File, patient?: string): Promise<GeneticPreview> => {
      // --- the raw genome text exists ONLY within this block --------------------
      const rawText = await readFileText(file);
      const arrayCalls = parseConsumerArray(rawText);
      let data: Omit<GeneticSummaryData, "consentGiven">;
      let source: SummarySource;
      if (arrayCalls.length > 0) {
        data = interpretConsumerArray(arrayCalls, patient ?? webId ?? undefined);
        source = "consumer-array";
      } else {
        data = interpretClinical(parseClinicalText(rawText), patient ?? webId ?? undefined);
        source = "clinical-report";
      }
      // `rawText` goes out of scope here; ONLY the interpreted `data` is returned.
      return { ...data, source };
    },
    [webId],
  );

  const save = useCallback(
    async (
      preview: GeneticPreview,
      consentGiven: boolean,
    ): Promise<{ summary: StoredGeneticSummary; syncing: Promise<void> }> => {
      // CONSENT GATE (fail-closed): no affirmative consent ⇒ nothing is written,
      // not even to the local cache. The model's builder enforces the same rule at
      // the write boundary; this is the belt-and-braces UI-side guard.
      if (consentGiven !== true) throw new ConsentRequiredError();
      if (!store || !storageRoot || !webId) throw new NotSignedInError();
      const record: StoredGeneticSummary = {
        kind: "genetic",
        url: geneticsSummaryUrl(storageRoot),
        markers: preview.markers,
        interpretation: preview.interpretation,
        coeliacGeneticRisk: preview.coeliacGeneticRisk,
        coverageComplete: preview.coverageComplete,
        sourceType: preview.source,
        consentGiven: true,
        createdAt: new Date().toISOString(),
        rev: ulid(),
        sync: "pending",
      };
      await store.putGeneticSummary(record);
      setSummary(record);
      const ctx = { authedFetch, webId, storageRoot };
      const syncing = (async () => {
        try {
          await syncGeneticSummary(ctx, record);
          // Discriminate by rev: if a newer save replaced this record while the
          // write was in flight, this stale completion is ignored (see markGeneticSync).
          await store.markGeneticSync(record.rev, "synced");
          setSummary(await store.getGeneticSummary());
        } catch (err) {
          await store.markGeneticSync(record.rev, "error", (err as Error).message);
          setSummary(await store.getGeneticSummary());
          throw err;
        }
      })();
      return { summary: record, syncing };
    },
    [store, storageRoot, webId, authedFetch],
  );

  return { summary, loaded, refresh, buildManualPreview, buildFilePreview, save };
}
