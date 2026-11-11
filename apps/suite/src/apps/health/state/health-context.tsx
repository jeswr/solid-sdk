// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { PartialImportError, writeSamples } from "../lib/data/import";
import {
  addMeasurement,
  canonicalValue,
  type HealthStore,
  loadMetric,
  metricRange,
  summarizeMetric,
} from "../lib/data/metrics";
import {
  type ClinicalKind,
  type ClinicalRecord,
  loadRecords,
  type RecordDraft,
  saveRecord,
} from "../lib/data/records";
import { createHealthDataStore } from "../lib/data/store";
import { PartialGpxImportError } from "../lib/data/workouts";
import type { Measurement, MetricKind, Precondition } from "../lib/model";
import { DiaryProvider } from "./diary-context";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready" | "empty"; data: T };
interface HealthContextValue {
  session: PodSession;
  store: HealthStore;
  revision: number;
  boot: AsyncState<null>;
  retryBoot(): void;
  pending: Measurement[];
  clock: Date;
  acknowledge(iris: readonly string[]): void;
  recordReadGeneration(): number;
  acknowledgeRecords(kind: ClinicalKind, generation: number): void;
  recordEdits: (ClinicalRecord & { generation: number })[];
  saving: number;
  invalidate(): void;
  mutate<T>(write: () => Promise<T>, message?: string): Promise<T>;
  add(
    kind: MetricKind | "blood-pressure",
    value: number,
    unit: string,
    at: Date,
    note: string,
    second?: number,
    operationId?: string,
  ): Promise<void>;
  save(
    kind: ClinicalKind,
    draft: RecordDraft,
    existing?: ClinicalRecord,
    operation?: { id: string; at: Date },
  ): Promise<void>;
}
const Context = createContext<HealthContextValue | null>(null);
export function HealthProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const store = useMemo(
    () => createHealthDataStore(session.fetch, session.storageUrl, session.webId),
    [session],
  );
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [revision, setRevision] = useState(0);
  const [boot, setBoot] = useState<AsyncState<null>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Measurement[]>([]);
  const [recordEdits, setRecordEdits] = useState<(ClinicalRecord & { generation: number })[]>([]);
  const recordGeneration = useRef(0);
  const completedRecordGeneration = useRef(0);
  const recordReadGeneration = useCallback(() => completedRecordGeneration.current, []);
  const [saving, setSaving] = useState(0);
  const acknowledge = useCallback((iris: readonly string[]) => {
    const known = new Set(iris);
    setPending((current) =>
      current.some((entry) => known.has(entry.iri))
        ? current.filter((entry) => !known.has(entry.iri))
        : current,
    );
  }, []);
  const acknowledgeRecords = useCallback((kind: ClinicalKind, generation: number) => {
    setRecordEdits((current) => {
      // A read begun after a completed write is authoritative, including when an
      // external writer changed or deleted the record before that read returned.
      const remaining = current.filter(
        (edit) => edit.kind !== kind || edit.generation > generation,
      );
      return remaining.length === current.length ? current : remaining;
    });
  }, []);
  const queue = useRef(Promise.resolve());
  const invalidate = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries initialization
  useEffect(() => {
    let live = true;
    setBoot({ status: "loading" });
    void ensureSample(session)
      .then(() => store.initialize())
      .then(
        () => {
          if (live) setBoot({ status: "ready", data: null });
        },
        (error: unknown) => {
          if (live) setBoot({ status: "error", error });
        },
      );
    return () => {
      live = false;
    };
  }, [session, store, attempt]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = session.subscribe((url) => {
      // Focus reconciliation can invalidate the storage root or an ancestor
      // container rather than a specific Health resource.
      if (url.startsWith(store.base) || (url.endsWith("/") && store.base.startsWith(url))) {
        clearTimeout(timer);
        timer = setTimeout(invalidate, 100);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [session, store, invalidate]);
  const mutate = useCallback(
    async <T,>(write: () => Promise<T>, message?: string): Promise<T> => {
      setSaving((value) => value + 1);
      const task = queue.current.then(write);
      queue.current = task.then(
        () => {},
        () => {},
      );
      try {
        const result = await task;
        invalidate();
        if (message) toast.success(message);
        return result;
      } catch (error) {
        invalidate();
        const underlying =
          error instanceof PartialImportError || error instanceof PartialGpxImportError
            ? error.cause
            : error;
        const conflict =
          typeof underlying === "object" &&
          underlying !== null &&
          "status" in underlying &&
          underlying.status === 412;
        toast.error(
          error instanceof PartialGpxImportError
            ? error.message
            : conflict
              ? "This item changed elsewhere. We refreshed your data. Review it before saving again."
              : error instanceof PartialImportError
                ? error.message
                : "Couldn't save to your private Health storage. Your change was rolled back.",
        );
        throw error;
      } finally {
        setSaving((value) => value - 1);
      }
    },
    [invalidate],
  );
  const add = useCallback(
    async (
      kind: MetricKind | "blood-pressure",
      value: number,
      unit: string,
      at: Date,
      note: string,
      second?: number,
      operationId?: string,
    ) => {
      const id = operationId ?? crypto.randomUUID();
      if (kind === "blood-pressure" && second === undefined)
        throw new Error("Both blood pressure values are required");
      const values: { kind: MetricKind; value: number }[] =
        kind === "blood-pressure"
          ? [
              { kind: "systolic", value },
              { kind: "diastolic", value: second as number },
            ]
          : [{ kind, value }];
      const items = values.map((entry) => ({
        iri: `${store.base}observations/${at.toISOString().slice(0, 7)}.ttl#${id}-${entry.kind}`,
        kind: entry.kind,
        value: canonicalValue(entry.kind, entry.value, unit),
        at,
        note,
        source: "Manual entry",
      }));
      setPending((current) => [...current, ...items]);
      try {
        await mutate(async () => {
          if (kind === "blood-pressure") await writeSamples(store, items, session.webId, () => {});
          else await addMeasurement(store, `${id}-${kind}`, kind, value, unit, at, note);
        }, "Measurement saved");
      } catch (error) {
        const failed = new Set(items.map((entry) => entry.iri));
        setPending((current) => current.filter((entry) => !failed.has(entry.iri)));
        throw error;
      }
    },
    [store, mutate, session],
  );
  const save = useCallback(
    async (
      kind: ClinicalKind,
      draft: RecordDraft,
      existing?: ClinicalRecord,
      operation?: { id: string; at: Date },
    ) => {
      const id = existing?.id ?? operation?.id ?? crypto.randomUUID();
      const iri = existing?.iri ?? `${store.base}${kind}/${id}.ttl#it`;
      if (existing && !existing.etag)
        throw new Error("This record cannot be safely edited without a version");
      const condition: Precondition = existing
        ? { etag: existing.etag as string }
        : { create: true };
      const generation = ++recordGeneration.current;
      const optimistic = {
        ...draft,
        id,
        iri,
        kind,
        etag: existing?.etag ?? null,
        reminders: [],
        generation,
      };
      setRecordEdits((current) => [...current.filter((record) => record.iri !== iri), optimistic]);
      try {
        await mutate(async () => {
          await saveRecord(
            store,
            session.webId,
            kind,
            id,
            draft,
            condition,
            operation?.at ?? new Date(),
            existing?.iri,
          );
          completedRecordGeneration.current = generation;
        }, "Record saved");
      } catch (error) {
        setRecordEdits((current) => current.filter((record) => record !== optimistic));
        throw error;
      }
    },
    [store, session, mutate],
  );
  return (
    <Context
      value={{
        session,
        store,
        revision,
        boot,
        retryBoot: () => setAttempt((value) => value + 1),
        pending,
        clock,
        acknowledge,
        acknowledgeRecords,
        recordReadGeneration,
        recordEdits,
        saving,
        invalidate,
        mutate,
        add,
        save,
      }}
    >
      <DiaryProvider key={`${session.webId}:${session.storageUrl}`}>{children}</DiaryProvider>
    </Context>
  );
}
export function useHealth() {
  const context = useContext(Context);
  if (!context) throw new Error("Health provider is required");
  return context;
}
export function useHealthResource<T>(
  loader: () => Promise<T>,
  empty: (data: T) => boolean,
): AsyncState<T> {
  const { revision, saving } = useHealth();
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  // Writes invalidate after settlement. Avoid exposing a half-written shard batch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the invalidation event
  useEffect(() => {
    if (saving) return;
    let live = true;
    void loader().then(
      (data) => {
        if (live) setState({ status: empty(data) ? "empty" : "ready", data });
      },
      (error: unknown) => {
        if (live) setState({ status: "error", error });
      },
    );
    return () => {
      live = false;
    };
  }, [loader, empty, revision, saving]);
  return state;
}
const EMPTY_MEASUREMENTS: Measurement[] = [];
const noEntries = (data: { entries: Measurement[] }) => data.entries.length === 0;
export function useMetric(kind: MetricKind | null, range: "7d" | "30d" | "1y") {
  const { store, pending, clock, acknowledge } = useHealth();
  const day = clock.toISOString().slice(0, 10);
  const bounds = useMemo(() => metricRange(range, new Date(day)), [range, day]);
  const signature = `${kind}:${range}:${day}`;
  const loader = useCallback(
    async () => ({
      ...(kind
        ? await loadMetric(store, kind, bounds, range === "1y" ? "week" : "day")
        : summarizeMetric([], "weight", "day")),
      signature,
    }),
    [store, kind, bounds, range, signature],
  );
  const state = useHealthResource(loader, noEntries);
  const loaded =
    state.status === "ready" || state.status === "empty" ? state.data.entries : EMPTY_MEASUREMENTS;
  useEffect(() => acknowledge(loaded.map((entry) => entry.iri)), [loaded, acknowledge]);
  if (state.status === "loading" || state.status === "error") return state;
  if (state.data.signature !== signature) return { status: "loading" as const };
  const entries = new Map(state.data.entries.map((entry) => [entry.iri, entry]));
  for (const entry of pending)
    if (entry.kind === kind && entry.at >= bounds.start && entry.at < bounds.end)
      entries.set(entry.iri, entry);
  const data = summarizeMetric(
    [...entries.values()],
    kind ?? "weight",
    range === "1y" ? "week" : "day",
  );
  return { status: data.entries.length ? ("ready" as const) : ("empty" as const), data };
}
const noRecords = (data: { records: ClinicalRecord[] }) => data.records.length === 0;
export function useRecords(kind: ClinicalKind) {
  const { store, recordEdits, acknowledgeRecords, recordReadGeneration } = useHealth();
  const loader = useCallback(async () => {
    const generation = recordReadGeneration();
    return { records: await loadRecords(store, kind), generation, kind };
  }, [store, kind, recordReadGeneration]);
  const state = useHealthResource(loader, noRecords);
  const loaded = state.status === "ready" || state.status === "empty" ? state.data : null;
  useEffect(() => {
    if (loaded) acknowledgeRecords(loaded.kind, loaded.generation);
  }, [loaded, acknowledgeRecords]);
  if (state.status === "loading" || state.status === "error") return state;
  if (state.data.kind !== kind) return { status: "loading" as const };
  const records = new Map(state.data.records.map((record) => [record.iri, record]));
  for (const record of recordEdits)
    if (record.kind === kind && record.generation > state.data.generation)
      records.set(record.iri, record);
  return {
    status: records.size ? ("ready" as const) : ("empty" as const),
    data: [...records.values()],
  };
}
