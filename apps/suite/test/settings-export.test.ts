// AUTHORED-BY Codex GPT-6.1-Sol
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { createTakeoutJob, exportFilename, exportFolders } from "../src/shell/settings/export-job";

const root = "https://demo.example/alice/";
function setup() {
  const pod = createDemoPod({
    root,
    seed: [
      { path: "notes/hello.txt", body: "hello takeout", contentType: "text/plain" },
      {
        path: "images/pixel.bin",
        body: new Uint8Array([0, 255, 42]),
        contentType: "application/octet-stream",
      },
    ],
  });
  let blob: Blob | undefined;
  const urls = {
    create: vi.fn((value: Blob) => {
      blob = value;
      return "blob:takeout";
    }),
    revoke: vi.fn(),
  };
  return { pod, urls, blob: () => blob, job: createTakeoutJob(pod.fetch, root, urls) };
}
describe("Settings Takeout", () => {
  it("plans demo folders, exports exact bytes, publishes progress and revokes downloads on refresh/dispose", async () => {
    const { job, urls, blob } = setup();
    const listener = vi.fn();
    const unsubscribe = job.subscribe(listener);
    expect(job.snapshot().phase).toBe("idle");
    await job.plan();
    const planned = job.snapshot().plan;
    expect(job.snapshot().phase).toBe("ready");
    expect(planned && exportFolders(planned)).toEqual([
      { url: `${root}images/`, label: "images/" },
      { url: `${root}notes/`, label: "notes/" },
    ]);
    await job.start();
    expect(job.snapshot().phase).toBe("complete");
    expect(job.snapshot().download).toBe("blob:takeout");
    const archive = unzipSync(new Uint8Array(await (blob() as Blob).arrayBuffer()));
    expect(new TextDecoder().decode(archive["pod/notes/hello.txt"])).toBe("hello takeout");
    expect(archive["pod/images/pixel.bin"]).toEqual(new Uint8Array([0, 255, 42]));
    expect(job.snapshot().manifest?.entries.some((r) => r.error?.status === 404)).toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    await job.plan(["notes/"]);
    expect(urls.revoke).toHaveBeenCalledWith("blob:takeout");
    expect(job.snapshot().plan?.resources.some((r) => r.url.includes("images"))).toBe(false);
    await job.start();
    job.dispose();
    expect(urls.revoke).toHaveBeenCalledTimes(2);
    await job.plan();
    expect(job.snapshot().phase).toBe("complete");
  });
  it("cancels planning and fences replaced/disposed operations even when fetch ignores signal", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const job = createTakeoutJob(fetch, root);
    const pending = job.plan();
    expect(job.snapshot().phase).toBe("planning");
    job.cancel();
    await pending;
    expect(job.snapshot().phase).toBe("cancelled");
    const replaced = job.plan();
    const fresh = job.plan([]);
    await Promise.all([replaced, fresh]);
    expect(job.snapshot().phase).toBe("ready");
    const disposed = job.plan();
    job.dispose();
    await disposed;
    expect(job.snapshot().phase).toBe("planning");
  });
  it("does not start without a plan; reports errors; can cancel an export", async () => {
    const initial = createTakeoutJob(async () => new Response(), "invalid root");
    await initial.start();
    expect(initial.snapshot().phase).toBe("idle");
    await initial.plan();
    expect(initial.snapshot().phase).toBe("error");
    const { pod, urls } = setup();
    let stall = false;
    const fetch: typeof globalThis.fetch = async (input, init) =>
      stall && init?.method !== "HEAD"
        ? new Response(new ReadableStream())
        : pod.fetch(input, init);
    const job = createTakeoutJob(fetch, root, urls);
    await job.plan();
    stall = true;
    const pending = job.start();
    expect(job.snapshot().phase).toBe("exporting");
    job.cancel();
    await pending;
    expect(job.snapshot().phase).toBe("cancelled");
    expect(urls.create).not.toHaveBeenCalled();
    stall = false;
    await job.plan();
    urls.create.mockImplementation(() => {
      throw new Error("Blob failed");
    });
    await job.start();
    expect(job.snapshot().phase).toBe("error");
  });
  it("names archives by UTC date and tolerates malformed encoded folder labels", () => {
    expect(exportFilename(new Date("2026-11-11T00:00:00Z"))).toBe("pod-export-2026-11-11.zip");
    expect(exportFilename()).toMatch(/^pod-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(
      exportFolders({
        root,
        estimatedBytes: 0,
        unknownSizes: 0,
        resources: [
          { url: root, kind: "container", contentType: "" },
          { url: `${root}caf%C3%A9/`, kind: "container", contentType: "" },
          { url: `${root}%ZZ/`, kind: "container", contentType: "" },
          { url: `${root}notes/nested/`, kind: "container", contentType: "" },
        ],
      }),
    ).toEqual([
      { url: `${root}caf%C3%A9/`, label: "café/" },
      { url: `${root}%ZZ/`, label: "%ZZ/" },
    ]);
  });
});
