// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { DemoSnapshotConflictError, type FormsStore } from "../lib/data/store";
import type { FormModel } from "../lib/runtime";

export interface FormsState {
  status: "loading" | "ready" | "error";
  forms: FormModel[];
  skipped: string[];
  pending: number;
  failed: boolean;
  refreshFailed: boolean;
}

/** Account-scoped optimistic form list; writes settle in their submission order. */
export class FormsController {
  private state: FormsState = {
    status: "loading",
    forms: [],
    skipped: [],
    pending: 0,
    failed: false,
    refreshFailed: false,
  };
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private confirmed: FormModel[] = [];
  private edits: { token: object; form: FormModel }[] = [];
  private generation = 0;
  private demoRefresh = 0;
  private savedDuringRead = new Map<string, FormModel>();
  constructor(
    readonly store: FormsStore,
    private reportError: () => void,
  ) {}
  getSnapshot = (): FormsState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<FormsState>) {
    let forms = this.confirmed;
    for (const edit of this.edits)
      forms = [...forms.filter((item) => item.shape !== edit.form.shape), edit.form];
    this.state = { ...this.state, ...patch, forms, pending: this.edits.length };
    for (const listener of this.listeners) listener();
  }
  async load() {
    const generation = ++this.generation;
    this.savedDuringRead.clear();
    this.publish({ status: "loading" });
    try {
      const { forms, skipped } = await this.store.listForms();
      if (generation !== this.generation) return;
      const merged = new Map(forms.map((form) => [form.shape, form]));
      for (const [original, saved] of this.savedDuringRead) {
        merged.delete(original);
        merged.set(saved.shape, saved);
      }
      this.confirmed = [...merged.values()];
      this.publish({ status: "ready", skipped, refreshFailed: false });
    } catch {
      if (generation === this.generation)
        // Keep the last successful skipped list alongside its confirmed forms.
        this.publish({
          status: this.confirmed.length ? "ready" : "error",
          refreshFailed: this.confirmed.length > 0,
        });
    }
  }
  save(form: FormModel): Promise<FormModel> {
    const edit = { token: {}, form: structuredClone(form) };
    const demoRefresh = this.demoRefresh;
    this.edits.push(edit);
    this.publish({ failed: false, status: "ready" });
    const task = this.queue.then(async () => {
      try {
        if (demoRefresh !== this.demoRefresh)
          throw new DemoSnapshotConflictError(
            this.confirmed.find((item) => item.shape === edit.form.shape),
          );
        const saved = await this.store.saveForm(edit.form);
        this.savedDuringRead.set(form.shape, saved);
        this.confirmed = [
          ...this.confirmed.filter(
            (item) => item.shape !== form.shape && item.shape !== saved.shape,
          ),
          saved,
        ];
        for (const waiting of this.edits) {
          if (
            waiting !== edit &&
            waiting.form.shape === edit.form.shape &&
            !waiting.form.editVersion &&
            !edit.form.editVersion
          ) {
            waiting.form = {
              ...waiting.form,
              shape: saved.shape,
              ...(saved.editVersion && { editVersion: saved.editVersion }),
            };
          }
        }
        this.publish({ failed: false });
        return saved;
      } catch (error) {
        if (error instanceof DemoSnapshotConflictError && demoRefresh === this.demoRefresh) {
          this.demoRefresh++;
          await this.load();
        }
        this.publish({ failed: true });
        this.reportError();
        throw error;
      } finally {
        this.edits = this.edits.filter((item) => item !== edit);
        this.publish({});
      }
    });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
}
