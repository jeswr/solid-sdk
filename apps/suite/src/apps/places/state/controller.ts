// AUTHORED-BY Codex (GPT-6.1 Sol)
import type {
  PlaceData,
  PlacesRepository,
  PlacesSnapshot,
  RecordValue,
  TimelineImport,
} from "@jeswr/solid-places";
import { sampleWeek } from "../demo/sample";

const empty = (): PlacesSnapshot => ({ places: [], visits: [], journeys: [] });
export interface PlacesState {
  status: "loading" | "ready" | "error";
  snapshot: PlacesSnapshot;
  saving: number;
  error: string | null;
}
/** One serialized mutation queue; confirmed values plus pending patches govern rollback. */
export function placesController(
  repository: PlacesRepository,
  demo: boolean,
  failed: (message: string) => void,
) {
  let state: PlacesState = { status: "loading", snapshot: empty(), saving: 0, error: null };
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
  async function importTimeline(
    input: TimelineImport,
    progress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) {
    ++generation;
    publish({ saving: state.saving + 1 });
    // Imports are queued with edits, but render progress without taking over the page.
    const task = queue.then(() => repository.importTimeline(input, progress, signal));
    queue = task.catch(() => {});
    try {
      await task;
    } finally {
      publish({ saving: Math.max(0, state.saving - 1) });
      await refresh();
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
    dispose: () => {
      alive = false;
      generation++;
      listeners.clear();
    },
  };
}
export type PlacesController = ReturnType<typeof placesController>;
