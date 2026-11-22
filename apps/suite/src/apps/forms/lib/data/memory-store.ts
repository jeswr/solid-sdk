// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createFakeRuntime } from "../fake-runtime";
import { formUrl } from "../form-url";
import type { FormModel } from "../runtime";
import type { DemoSnapshot, FormsStore } from "./store";

/** JSON-only test/demo store. An optional snapshot writer backs it with the demo pod. */
export function createMemoryFormsStore(
  root: string,
  initial: DemoSnapshot,
  persist: (snapshot: DemoSnapshot) => Promise<void> = async () => {},
): FormsStore {
  const runtime = createFakeRuntime();
  let snapshot = structuredClone(initial);
  let queue = Promise.resolve();
  const update = <T>(change: (draft: DemoSnapshot) => Promise<T>): Promise<T> => {
    const task = queue.then(async () => {
      const draft = structuredClone(snapshot);
      const result = await change(draft);
      await persist(draft);
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
      update(async (draft) => {
        const graph = runtime.formToShapes(form);
        await runtime.serialize(graph);
        const saved = runtime.compileForm(graph, form.shape);
        draft.forms = [...draft.forms.filter((item) => item.shape !== form.shape), saved];
        return structuredClone(saved);
      }),
    listResponses: async (form: FormModel) =>
      structuredClone(snapshot.responses.filter((response) => response.form === form.shape)),
    submit: (form, values) =>
      update(async (draft) => {
        const subject = new URL(`forms/responses/${crypto.randomUUID()}.ttl#response`, root).href;
        const graph = runtime.build(form, subject, values);
        await runtime.serialize(graph);
        const response = { subject, form: form.shape, values: runtime.parse(form, subject, graph) };
        draft.responses.push(response);
        return structuredClone(response);
      }),
  };
}
