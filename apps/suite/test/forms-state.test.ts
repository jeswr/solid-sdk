// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it, vi } from "vitest";
import { sampleForms } from "../src/apps/forms/demo/sample";
import { createMemoryFormsStore } from "../src/apps/forms/lib/data/memory-store";
import { FormsController } from "../src/apps/forms/state/controller";

const root = "https://pod.example/";
const first = sampleForms(root).forms[0];
if (!first) throw new Error("Missing fixture");
const form = first;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const store = () => createMemoryFormsStore(root, sampleForms(root));

describe("optimistic forms controller", () => {
  it("reconciles allocated form identifiers in queued saves", async () => {
    const backing = store();
    const canonical = "https://pod.example/forms/server-assigned#form";
    const save = vi
      .spyOn(backing, "saveForm")
      .mockImplementation(async (draft) => ({ ...draft, shape: canonical }));
    const controller = new FormsController(backing, vi.fn());
    await controller.load();
    const a = controller.save({ ...form, label: "First" });
    const b = controller.save({ ...form, label: "Second" });
    await Promise.all([a, b]);
    expect(save.mock.calls[1]?.[0].shape).toBe(canonical);
    expect(controller.getSnapshot().forms.filter((item) => item.shape === canonical)).toHaveLength(
      1,
    );
    expect(controller.getSnapshot().forms.find((item) => item.shape === canonical)?.label).toBe(
      "Second",
    );
  });
  it("loads and notifies subscribers, then unsubscribes", async () => {
    const controller = new FormsController(store(), vi.fn());
    const listener = vi.fn();
    const stop = controller.subscribe(listener);
    expect(controller.getSnapshot().status).toBe("loading");
    await controller.load();
    expect(controller.getSnapshot().forms).toHaveLength(2);
    expect(controller.getSnapshot().status).toBe("ready");
    const count = listener.mock.calls.length;
    stop();
    await controller.load();
    expect(listener).toHaveBeenCalledTimes(count);
  });
  it("keeps a newer optimistic save visible when an earlier save fails", async () => {
    const backing = store();
    const write = deferred<typeof form>();
    const report = vi.fn();
    const save = vi.spyOn(backing, "saveForm").mockImplementationOnce(() => write.promise);
    const controller = new FormsController(backing, report);
    await controller.load();
    const a = controller.save({ ...form, label: "Earlier" });
    const caught = a.catch(() => undefined);
    const b = controller.save({ ...form, label: "Latest" });
    expect(controller.getSnapshot().pending).toBe(2);
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      "Latest",
    );
    write.reject(new Error("offline"));
    await caught;
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      "Latest",
    );
    await b;
    expect(save).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().pending).toBe(0);
    expect((await backing.loadForm(form.shape)).label).toBe("Latest");
  });
  it("restores the confirmed baseline when both writes fail", async () => {
    const backing = store();
    vi.spyOn(backing, "saveForm").mockRejectedValue(new Error("offline"));
    const controller = new FormsController(backing, vi.fn());
    await controller.load();
    await Promise.allSettled([
      controller.save({ ...form, label: "A" }),
      controller.save({ ...form, label: "B" }),
    ]);
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      form.label,
    );
    expect(controller.getSnapshot().failed).toBe(true);
  });
  it("merges a late list beneath saved edits and keeps several other forms", async () => {
    const backing = store();
    const read = deferred<Awaited<ReturnType<ReturnType<typeof store>["listForms"]>>>();
    vi.spyOn(backing, "listForms").mockImplementationOnce(() => read.promise);
    const controller = new FormsController(backing, vi.fn());
    const loading = controller.load();
    await controller.save({ ...form, label: "New" });
    const others = [1, 2, 3].map((n) => ({
      ...form,
      shape: `${root}forms/${n}#form`,
      label: `Form ${n}`,
    }));
    read.resolve({ forms: [form, ...others], skipped: ["https://pod.example/empty"] });
    await loading;
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      "New",
    );
    expect(controller.getSnapshot().forms).toHaveLength(4);
    expect(controller.getSnapshot().skipped).toEqual(["https://pod.example/empty"]);
    const bad = deferred<Awaited<ReturnType<ReturnType<typeof store>["listForms"]>>>();
    vi.spyOn(backing, "listForms").mockImplementationOnce(() => bad.promise);
    const retry = controller.load();
    await controller.save({ ...form, label: "Newest" });
    bad.reject(new Error("offline"));
    await retry;
    expect(controller.getSnapshot().status).toBe("ready");
  });
  it("merges list results under a pending edit, then rolls back to that baseline on failure", async () => {
    const backing = store();
    const read = deferred<Awaited<ReturnType<typeof backing.listForms>>>();
    const write = deferred<typeof form>();
    vi.spyOn(backing, "listForms").mockReturnValueOnce(read.promise);
    vi.spyOn(backing, "saveForm").mockReturnValueOnce(write.promise);
    const controller = new FormsController(backing, vi.fn());
    const loading = controller.load();
    const saving = controller.save({ ...form, label: "Draft" }).catch(() => {});
    read.resolve({ forms: sampleForms(root).forms, skipped: [] });
    await loading;
    expect(controller.getSnapshot().forms).toHaveLength(2);
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      "Draft",
    );
    write.reject(new Error("offline"));
    await saving;
    expect(controller.getSnapshot().forms.find((item) => item.shape === form.shape)?.label).toBe(
      form.label,
    );
  });
  it("discards superseded list reads and errors, while retaining only the latest list", async () => {
    const backing = store();
    const read = deferred<Awaited<ReturnType<typeof backing.listForms>>>();
    const bad = deferred<Awaited<ReturnType<typeof backing.listForms>>>();
    vi.spyOn(backing, "listForms")
      .mockReturnValueOnce(read.promise)
      .mockReturnValueOnce(bad.promise);
    const controller = new FormsController(backing, vi.fn());
    const a = controller.load();
    const b = controller.load();
    await controller.load();
    read.resolve({ forms: [], skipped: [] });
    bad.reject(new Error("offline"));
    await Promise.all([a, b]);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().forms).toHaveLength(2);
  });
  it("reports a load error and recovers on retry", async () => {
    const backing = store();
    vi.spyOn(backing, "listForms").mockRejectedValueOnce(new Error("offline"));
    const controller = new FormsController(backing, vi.fn());
    await controller.load();
    expect(controller.getSnapshot().status).toBe("error");
    await controller.load();
    expect(controller.getSnapshot().status).toBe("ready");
  });
});
