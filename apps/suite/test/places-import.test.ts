// AUTHORED-BY Codex (GPT-6.1 Sol)
import { IMPORT_LIMITS } from "@jeswr/solid-places";
import { expect, it, vi } from "vitest";
import { sampleWeek } from "../src/apps/places/demo/sample";
import { readTimeline } from "../src/apps/places/lib/import-worker";

function worker() {
  return {
    terminate: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
  };
}
it("runs JSON parsing off the page, retains Date objects, and terminates afterwards", async () => {
  const w = worker();
  const file = new File(["{}"], "Timeline.json");
  const signal = new AbortController().signal;
  const promise = readTimeline(file, signal, () => w as unknown as Worker);
  expect(w.postMessage).toHaveBeenCalledWith(file);
  w.onmessage?.call(
    w as unknown as Worker,
    new MessageEvent("message", { data: { data: sampleWeek() } }),
  );
  expect((await promise).visits[0]?.data.startTime).toBeInstanceOf(Date);
  expect(w.terminate).toHaveBeenCalled();
});
it("refuses a zip or oversized file before creating a worker", async () => {
  const make = vi.fn();
  const signal = new AbortController().signal;
  await expect(
    readTimeline({ name: "Timeline.json", size: IMPORT_LIMITS.bytes + 1 } as File, signal, make),
  ).rejects.toThrow("32 MiB");
  await expect(readTimeline(new File(["zip"], "Takeout.zip"), signal, make)).rejects.toThrow(
    /extract/i,
  );
  expect(make).not.toHaveBeenCalled();
});
it("cancels before and during parsing", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const file = new File(["{}"], "Timeline.json");
  const make = vi.fn();
  await expect(readTimeline(file, cancelled.signal, make)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(make).not.toHaveBeenCalled();
  const active = new AbortController();
  const w = worker();
  const pending = readTimeline(file, active.signal, () => w as unknown as Worker);
  active.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(w.terminate).toHaveBeenCalled();
});
it("surfaces worker errors, browser errors and malformed messages", async () => {
  const file = new File(["{}"], "Timeline.json");
  const signal = new AbortController().signal;
  await expect(
    readTimeline(file, signal, () => {
      throw new Error("CSP");
    }),
  ).rejects.toThrow("browser");
  for (const message of [{ error: "Invalid JSON" }, {}]) {
    const w = worker();
    const promise = readTimeline(file, signal, () => w as unknown as Worker);
    w.onmessage?.call(w as unknown as Worker, new MessageEvent("message", { data: message }));
    await expect(promise).rejects.toThrow();
    expect(w.terminate).toHaveBeenCalled();
  }
  const w = worker();
  const promise = readTimeline(file, signal, () => w as unknown as Worker);
  w.onerror?.call(w as unknown as Worker, new Event("error") as ErrorEvent);
  await expect(promise).rejects.toThrow("Could not read");
});
it("constructs the browser Worker by default", async () => {
  const w = worker();
  vi.stubGlobal("Worker", function BrowserWorker() {
    return w;
  });
  try {
    const pending = readTimeline(new File(["{}"], "Timeline.json"), new AbortController().signal);
    w.onmessage?.call(
      w as unknown as Worker,
      new MessageEvent("message", { data: { data: sampleWeek() } }),
    );
    await expect(pending).resolves.toEqual(sampleWeek());
  } finally {
    vi.unstubAllGlobals();
  }
});
