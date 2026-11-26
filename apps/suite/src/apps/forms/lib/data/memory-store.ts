// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { createFakeRuntime } from "../fake-runtime";
import { formUrl } from "../form-url";
import type { FormModel } from "../runtime";
import { type DemoSnapshot, DemoSnapshotConflictError, type FormsStore } from "./store";

/** JSON-only test/demo store. A writer can return a newer snapshot on conflict. */
export function createMemoryFormsStore(
  root: string,
  initial: DemoSnapshot,
  persist: (snapshot: DemoSnapshot) => Promise<DemoSnapshot | undefined> = async () => undefined,
): FormsStore {
  const runtime = createFakeRuntime();
  let snapshot = structuredClone(initial);
  let queue = Promise.resolve();
  let refresh = 0;
  const update = <T>(shape: string, change: (draft: DemoSnapshot) => Promise<T>): Promise<T> => {
    const generation = refresh;
    const conflict = () =>
      new DemoSnapshotConflictError(
        structuredClone(snapshot.forms.find((form) => form.shape === shape)),
      );
    const task = queue.then(async () => {
      if (generation !== refresh) throw conflict();
      const draft = structuredClone(snapshot);
      const result = await change(draft);
      const latest = await persist(draft);
      if (latest) {
        snapshot = latest;
        refresh++;
        throw conflict();
      }
      snapshot = draft;
      return result;
    });
    queue = task.then(
      () => {},
      () => {},
    );
    return task;
  };
  return {
    validate: runtime.validate,
    isForeign: (url) => formUrl(url).origin !== new URL(root).origin,
    listForms: async () => ({ forms: structuredClone(snapshot.forms), skipped: [] }),
    async loadForm(shape) {
      formUrl(shape);
      const model = snapshot.forms.find((form) => form.shape === shape);
      if (!model) throw new Error("Form not found");
      return runtime.compileForm({ model }, shape);
    },
    saveForm: (form) =>
      update(form.shape, async (draft) => {
        const graph = runtime.formToShapes(form);
        await runtime.serialize(graph);
        const saved = runtime.compileForm(graph, form.shape);
        draft.forms = [...draft.forms.filter((item) => item.shape !== form.shape), saved];
        return structuredClone(saved);
      }),
    listResponses: async (form: FormModel) =>
      structuredClone(snapshot.responses.filter((response) => response.form === form.shape)),
    submit: (form, values) =>
      update(form.shape, async (draft) => {
        const subject = new URL(`forms/responses/${crypto.randomUUID()}.ttl#response`, root).href;
        const graph = runtime.build(form, subject, values);
        await runtime.serialize(graph);
        const response = { subject, form: form.shape, values: runtime.parse(form, subject, graph) };
        draft.responses.push(response);
        return structuredClone(response);
      }),
  };
}
