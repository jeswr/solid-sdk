// AUTHORED-BY Codex (GPT-6.1 Sol)
import type {
  PlaceData,
  PlacesRepository,
  PlacesSnapshot,
  RecordValue,
  TimelineImport,
} from "@jeswr/solid-places";
import { sampleWeek } from "../demo/sample";
import { readTimeline } from "../lib/import-worker";

const empty = (): PlacesSnapshot => ({ places: [], visits: [], journeys: [] });
export interface PlacesState {
  status: "loading" | "ready" | "error";
  snapshot: PlacesSnapshot;
  saving: number;
  error: string | null;
  import: {
    preview: TimelineImport | null;
    stage: "idle" | "reading" | "saving" | "done";
    progress: { done: number; total: number };
    error: string;
    filename: string;
  };
}
/** One serialized mutation queue; confirmed values plus pending patches govern rollback. */
export function placesController(
  repository: PlacesRepository,
  demo: boolean,
  failed: (message: string) => void,
) {
  let state: PlacesState = {
    status: "loading",
    snapshot: empty(),
    saving: 0,
    error: null,
    import: {
      preview: null,
      stage: "idle",
      progress: { done: 0, total: 0 },
      error: "",
      filename: "",
    },
  };
  let operation: AbortController | undefined;
  const listeners = new Set<() => void>();
  let alive = true;
  let generation = 0;
  let queue = Promise.resolve();
  let confirmed = empty();
  const edits = new Map<
    number,
    { url: string; patch: Partial<Pick<PlaceData, "name" | "category" | "notes" | "saved">> }
  >();
  let nextEdit = 0;
  const publish = (next: Partial<PlacesState>) => {
    if (!alive) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const visible = () => {
    const byUrl = new Map(confirmed.places.map((place) => [place.url, place]));
    for (const { url, patch } of edits.values()) {
      const original = byUrl.get(url);
      if (original) byUrl.set(url, { ...original, data: { ...original.data, ...patch } });
    }
    return { ...confirmed, places: [...byUrl.values()] };
  };
  async function open() {
    const current = ++generation;
    publish({ status: "loading", error: null });
    try {
      await repository.initialize();
      if (demo) await repository.importTimeline(sampleWeek());
      const data = await repository.load();
      if (alive && current === generation) {
        confirmed = data;
        publish({ status: "ready", snapshot: visible() });
      }
    } catch {
      if (current === generation)
        publish({
          status: "error",
          snapshot: empty(),
          error:
            "We could not confirm private access to your places. Check your connection and storage permissions, then try again.",
        });
    }
  }
  async function refresh() {
    if (state.saving) return;
    const current = ++generation;
    try {
      const data = await repository.load();
      if (alive && current === generation) {
        confirmed = data;
        publish({ snapshot: visible(), status: "ready", error: null });
      }
    } catch {
      if (current === generation)
        publish({
          status: "error",
          snapshot: empty(),
          error: "Your places could not be refreshed. Reconnect and try again.",
        });
    }
  }
  function save(
    place: RecordValue<PlaceData>,
    patch: Partial<Pick<PlaceData, "name" | "category" | "notes" | "saved">>,
  ) {
    if (Object.entries(patch).every(([key, value]) => place.data[key as keyof PlaceData] === value))
      return Promise.resolve();
    const id = ++nextEdit;
    edits.set(id, { url: place.url, patch });
    ++generation;
    publish({ snapshot: visible(), saving: state.saving + 1 });
    const task = queue.then(async () => {
      if (!alive) return;
      const baseline = confirmed.places.find((item) => item.url === place.url);
      if (!baseline) throw new Error("Place no longer exists");
      const written = await repository.savePlace(baseline, patch);
      confirmed = {
        ...confirmed,
        places: confirmed.places.map((item) => (item.url === place.url ? written : item)),
      };
    });
    queue = task.catch(() => {});
    return task
      .catch(() => {
        if (alive)
          failed(
            "Could not save this place. Your change was rolled back; reconnect or reload and try again.",
          );
      })
      .finally(() => {
        edits.delete(id);
        publish({ snapshot: visible(), saving: Math.max(0, state.saving - 1) });
      });
  }
  const publishImport = (next: Partial<PlacesState["import"]>) =>
    publish({ import: { ...state.import, ...next } });
  async function readFile(file: File) {
    if (!alive || state.import.stage === "saving") return;
    operation?.abort();
    const active = new AbortController();
    operation = active;
    publishImport({ preview: null, stage: "reading", error: "", filename: file.name });
    try {
      const preview = await readTimeline(file, active.signal);
      if (operation === active && !active.signal.aborted) publishImport({ preview, stage: "idle" });
    } catch (reason) {
      if (operation === active)
        publishImport({
          stage: "idle",
          error: active.signal.aborted
            ? "Reading cancelled."
            : reason instanceof Error
              ? reason.message
              : "Could not read this file.",
        });
    }
  }
  async function importTimeline(input: TimelineImport) {
    if (!alive || state.import.stage === "saving" || state.import.stage === "reading") return;
    const active = new AbortController();
    operation = active;
    ++generation;
    publish({ saving: state.saving + 1 });
    publishImport({
      stage: "saving",
      error: "",
      progress: {
        done: 0,
        total: input.places.length + input.visits.length + input.journeys.length,
      },
    });
    // Account-owned work survives view unmounts. Only explicit cancel or disposal aborts.
    const task = queue.then(() => {
      active.signal.throwIfAborted();
      return repository.importTimeline(
        input,
        (done, total) => {
          if (!active.signal.aborted) publishImport({ progress: { done, total } });
        },
        active.signal,
      );
    });
    queue = task.catch(() => {});
    try {
      await task;
      active.signal.throwIfAborted();
      publishImport({ stage: "done" });
    } catch (reason) {
      publishImport({
        stage: "idle",
        error: active.signal.aborted
          ? "Import cancelled. Records already saved are kept; re-importing this file will skip them."
          : "The import stopped. Records already saved are kept. Reconnect or check your private storage, then retry.",
      });
      if (alive && !active.signal.aborted)
        failed("Some history could not be saved. You can safely retry this file.");
      throw reason;
    } finally {
      publish({ saving: Math.max(0, state.saving - 1) });
      if (alive) await refresh();
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    refresh,
    save,
    importTimeline,
    readFile,
    cancelImport: () => operation?.abort(),
    dispose: () => {
      alive = false;
      operation?.abort();
      generation++;
      listeners.clear();
    },
  };
}
export type PlacesController = ReturnType<typeof placesController>;
