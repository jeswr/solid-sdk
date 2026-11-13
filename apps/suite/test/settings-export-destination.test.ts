// AUTHORED-BY Codex GPT-6.1-Sol
import { ExportLimitError, type ExportPlan, type ExportPodOptions } from "@jeswr/pod-export";
import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ plan: vi.fn(), export: vi.fn() }));
vi.mock("@jeswr/pod-export", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-export")>()),
  planExport: sdk.plan,
  exportPod: sdk.export,
}));

import {
  createTakeoutJob,
  MEMORY_EXPORT_LIMIT,
  type PickExportFile,
} from "../src/shell/settings/export-job";

const root = "https://pod.example/alice/";
const manifest = { root, exportedAt: "2026-11-11T00:00:00Z", entries: [] };
function planned(extra: Partial<ExportPlan> = {}): ExportPlan {
  return { root, resources: [], estimatedBytes: 0, unknownSizes: 0, ...extra };
}
function setup(pickFile?: PickExportFile) {
  const urls = { create: vi.fn(() => "blob:export"), revoke: vi.fn() };
  return { job: createTakeoutJob(vi.fn(), root, urls, pickFile), urls };
}
function destination() {
  return {
    write: vi.fn(async () => {}),
    seek: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  sdk.plan.mockReset().mockResolvedValue(planned());
  sdk.export.mockReset().mockResolvedValue(manifest);
});

it("rejects a large Blob estimate before fetching and gives actionable limit errors", async () => {
  sdk.plan.mockResolvedValue(planned({ estimatedBytes: MEMORY_EXPORT_LIMIT }));
  const { job } = setup();
  await job.plan();
  await job.start();
  expect(sdk.export).not.toHaveBeenCalled();
  expect(job.snapshot().error).toMatch(/1 GiB.*Choose folders/);
  sdk.plan.mockRejectedValue(new ExportLimitError("maxEntries"));
  await job.plan();
  expect(job.snapshot().error).toMatch(/limit.*Choose folders/);
});

it("warns for unknown sizes and enforces the actual Blob byte limit", async () => {
  sdk.plan.mockResolvedValue(planned({ unknownSizes: 2 }));
  sdk.export.mockImplementation(async (options: ExportPodOptions) => {
    await options.sink({ byteLength: MEMORY_EXPORT_LIMIT } as Uint8Array);
    return manifest;
  });
  const { job, urls } = setup();
  await job.plan();
  expect(job.snapshot().warning).toMatch(/unknown.*choose folders/i);
  await job.start();
  expect(job.snapshot().error).toMatch(/1 GiB.*Choose folders/);
  expect(urls.create).not.toHaveBeenCalled();
});

it("asks for a file first, streams with backpressure, patches headers and closes without a Blob", async () => {
  const file = destination();
  const picker = vi.fn(async () => ({ createWritable: async () => file }));
  sdk.plan.mockResolvedValue(planned({ estimatedBytes: MEMORY_EXPORT_LIMIT * 2 }));
  sdk.export.mockImplementation(async (options: ExportPodOptions) => {
    expect(picker).toHaveBeenCalledTimes(1);
    await options.sink(new Uint8Array([1, 2, 3]));
    await options.patch?.(0, new Uint8Array([4]));
    await options.sink(new Uint8Array([5]));
    return manifest;
  });
  const { job, urls } = setup(picker);
  await job.plan();
  const started = job.start();
  expect(picker).toHaveBeenCalledTimes(1);
  expect(sdk.export).not.toHaveBeenCalled();
  await started;
  expect(file.seek.mock.calls).toEqual([[0], [3]]);
  expect(file.write.mock.calls).toEqual([
    [new Uint8Array([1, 2, 3])],
    [new Uint8Array([4])],
    [new Uint8Array([5])],
  ]);
  expect(file.close).toHaveBeenCalledTimes(1);
  expect(file.abort).not.toHaveBeenCalled();
  expect(urls.create).not.toHaveBeenCalled();
  expect(job.snapshot()).toMatchObject({ phase: "complete", saved: true });
});

it("aborts a destination on write/close failure and tolerates cleanup failure", async () => {
  for (const failure of ["write", "close"] as const) {
    const file = destination();
    file[failure].mockRejectedValue(new Error("disk full"));
    file.abort.mockRejectedValue(new Error("already closed"));
    sdk.export.mockImplementation(async (options: ExportPodOptions) => {
      await options.sink(new Uint8Array([1]));
      return manifest;
    });
    const { job } = setup(async () => ({ createWritable: async () => file }));
    await job.plan();
    await job.start();
    expect(job.snapshot()).toMatchObject({ phase: "error", error: "Export failed. Try again." });
    expect(file.abort).toHaveBeenCalledTimes(1);
  }
});

it("handles picker cancellation and cancellation during picker/writable creation", async () => {
  const cancelled = setup(async () => {
    throw new DOMException("cancelled", "AbortError");
  });
  await cancelled.job.plan();
  await cancelled.job.start();
  expect(cancelled.job.snapshot().error).toMatch(/No file was selected/);
  expect(cancelled.job.snapshot().phase).toBe("ready");
  for (const stage of ["picker", "writable"] as const) {
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const file = destination();
    const createWritable = vi.fn(async () => {
      if (stage === "writable") await wait;
      return file;
    });
    const picker = async () => {
      if (stage === "picker") await wait;
      return { createWritable };
    };
    const { job } = setup(picker);
    await job.plan();
    const pending = job.start();
    await Promise.resolve();
    job.cancel();
    finish();
    await pending;
    expect(job.snapshot().phase).toBe("cancelled");
    expect(file.close).not.toHaveBeenCalled();
    if (stage === "writable") expect(file.abort).toHaveBeenCalled();
    else expect(createWritable).not.toHaveBeenCalled();
  }
});

it("retains emitted chunks without copies and throttles progress state notifications", async () => {
  const chunk = new Uint8Array([1, 2, 3]);
  const parts: BlobPart[][] = [];
  const OriginalBlob = Blob;
  vi.stubGlobal(
    "Blob",
    class extends OriginalBlob {
      constructor(chunks: BlobPart[], options: BlobPropertyBag) {
        parts.push([...chunks]);
        super(chunks, options);
      }
    },
  );
  sdk.export.mockImplementation(async (options: ExportPodOptions) => {
    for (let i = 0; i < 1000; i++)
      options.onProgress?.({ files: 0, totalFiles: 1, bytes: i, estimatedBytes: 0, current: root });
    await options.sink(chunk);
    await options.patch?.(0, new Uint8Array([4]));
    return manifest;
  });
  const { job } = setup();
  await job.plan();
  const listener = vi.fn();
  job.subscribe(listener);
  try {
    await job.start();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(parts[0]?.[0]).toBe(chunk);
  expect(chunk[0]).toBe(4);
  expect(listener.mock.calls.length).toBeLessThan(5);
  expect(job.snapshot().phase).toBe("complete");
});

it("automatically selects the browser save-file picker when available", async () => {
  const file = destination();
  const picker = vi.fn(async () => ({ createWritable: async () => file }));
  vi.stubGlobal("showSaveFilePicker", picker);
  try {
    const { job, urls } = setup();
    await job.plan();
    await job.start();
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: expect.stringMatching(/^pod-export-.*\.zip$/) }),
    );
    expect(job.snapshot().saved).toBe(true);
    expect(urls.create).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
