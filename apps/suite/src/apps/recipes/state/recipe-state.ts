// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { Day, PlanRecord, RecipeData, RecipeRecord, RecipeStore } from "@jeswr/solid-recipe";
import { StorageError } from "@jeswr/storage-client";

export interface RecipeSnapshot {
  recipes: RecipeRecord[];
  plans: PlanRecord[];
  status: "loading" | "ready" | "error";
  pending: number;
}
type Content = Pick<RecipeSnapshot, "recipes" | "plans">;
interface Operation {
  apply: (value: Content) => Content;
  run: (value: Content) => Promise<Content>;
}

/** Recipe-specific serial queue: failed intents leave the confirmed baseline intact. */
export function createRecipeState(store: RecipeStore, onError: () => void) {
  let confirmed: Content = { recipes: [], plans: [] };
  let snapshot: RecipeSnapshot = { ...confirmed, status: "loading", pending: 0 };
  const listeners = new Set<() => void>();
  const operations: Operation[] = [];
  let generation = 0;
  let alive = true;
  const emit = (status: RecipeSnapshot["status"] = snapshot.status) => {
    if (!alive) return;
    snapshot = {
      ...operations.reduce((value, op) => op.apply(value), confirmed),
      status,
      pending: operations.length,
    };
    for (const listener of listeners) listener();
  };
  async function drain() {
    while (operations.length && alive) {
      const op = operations[0] as Operation;
      try {
        const next = await op.run(confirmed);
        if (alive) confirmed = next;
      } catch {
        if (alive) onError();
      }
      operations.shift();
      emit();
    }
  }
  const enqueue = (op: Operation) => {
    if (!alive) return;
    generation++;
    operations.push(op);
    emit();
    if (operations.length === 1) void drain();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    async refresh() {
      if (!alive || operations.length) return;
      const captured = ++generation;
      try {
        const data = await store.list();
        if (!alive || captured !== generation) return;
        confirmed = data;
        emit("ready");
      } catch (error) {
        if (!alive || captured !== generation) return;
        if (
          snapshot.status === "ready" &&
          error instanceof StorageError &&
          error.code === "network"
        ) {
          // A disconnected pod cannot invalidate recipes already open on this device.
          emit("ready");
          return;
        }
        // Failed refreshes never paint data whose access may have been revoked.
        confirmed = { recipes: [], plans: [] };
        emit("error");
      }
    },
    save(data: RecipeData, url?: string) {
      const temporary = `local:${crypto.randomUUID()}`;
      // These fields have separate owners; the editor does not modify them.
      const edited = (original: RecipeData): RecipeData => ({
        ...data,
        favourite: original.favourite,
        created: original.created,
      });
      const apply = (value: Content): Content => ({
        ...value,
        recipes: url
          ? value.recipes.map((record) =>
              record.url === url ? { ...record, data: edited(record.data) } : record,
            )
          : [...value.recipes, { url: temporary, etag: "", data }],
      });
      enqueue({
        apply,
        async run(value) {
          const original = value.recipes.find((record) => record.url === url);
          if (url && !original) throw new Error("Recipe no longer exists");
          const saved = original
            ? await store.update(original, edited(original.data))
            : await store.create(data);
          return {
            ...value,
            recipes: original
              ? value.recipes.map((record) => (record.url === url ? saved : record))
              : [...value.recipes, saved],
          };
        },
      });
    },
    favourite(url: string) {
      const record = snapshot.recipes.find((item) => item.url === url);
      if (!record) return;
      const favourite = !record.data.favourite;
      const apply = (value: Content): Content => ({
        ...value,
        recipes: value.recipes.map((item) =>
          item.url === url ? { ...item, data: { ...item.data, favourite } } : item,
        ),
      });
      enqueue({
        apply,
        async run(value) {
          const original = value.recipes.find((item) => item.url === url);
          if (!original) throw new Error("Recipe no longer exists");
          const saved = await store.update(original, {
            ...original.data,
            favourite,
            modified: new Date(),
          });
          return {
            ...value,
            recipes: value.recipes.map((item) => (item.url === url ? saved : item)),
          };
        },
      });
    },
    assign(week: string, day: Day, recipe?: string) {
      const patch = (plan?: PlanRecord): PlanRecord => ({
        url: plan?.url ?? `local:plan:${week}`,
        etag: plan?.etag ?? "",
        data: { ...plan?.data, name: week, [day]: recipe },
      });
      const apply = (value: Content): Content => {
        const previous = value.plans.find((plan) => plan.data.name === week);
        return {
          ...value,
          plans: [...value.plans.filter((plan) => plan !== previous), patch(previous)],
        };
      };
      enqueue({
        apply,
        async run(value) {
          const previous = value.plans.find((plan) => plan.data.name === week);
          const saved = await store.savePlan(patch(previous).data, previous);
          return { ...value, plans: [...value.plans.filter((plan) => plan !== previous), saved] };
        },
      });
    },
    dispose() {
      alive = false;
      generation++;
      listeners.clear();
    },
  };
}
export type RecipeState = ReturnType<typeof createRecipeState>;
