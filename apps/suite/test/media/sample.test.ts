// AUTHORED-BY Codex (GPT-6.1 Sol)

import { createMediaRepository, type MediaRepository, validateEntry } from "@jeswr/solid-media-log";
import { describe, expect, it, vi } from "vitest";
import { ensureMediaSample, sampleMedia } from "../../src/apps/media/demo/sample";
import { DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed } from "../../src/lib/demo-pod/seed";

describe("demo samples", () => {
  it("uses realistic fictional works, all kinds and shelves, with valid data", () => {
    const entries = sampleMedia(2026);
    expect(entries.every((entry) => validateEntry(entry))).toBe(true);
    expect(new Set(entries.map((entry) => entry.kind))).toEqual(
      new Set(["film", "tv", "book", "game"]),
    );
    expect(new Set(entries.map((entry) => entry.status))).toEqual(
      new Set(["want", "in-progress", "finished", "abandoned"]),
    );
  });
  it("does nothing outside demo mode, seeds once and retries partial failures", async () => {
    const repo: MediaRepository = {
      load: vi.fn(async () => ({ records: [], incomplete: false })),
      save: vi.fn(async (data) => ({ id: data.title, url: null, etag: null, data })),
    };
    await ensureMediaSample(repo, "solid");
    expect(repo.load).not.toHaveBeenCalled();
    vi.mocked(repo.save).mockRejectedValueOnce(new Error("Offline"));
    await expect(ensureMediaSample(repo, "demo", new Date("2026-01-01"))).rejects.toThrow(
      "Offline",
    );
    const task = ensureMediaSample(repo, "demo", new Date("2026-01-01"));
    expect(ensureMediaSample(repo, "demo")).toBe(task);
    await task;
    expect(repo.save).toHaveBeenCalledTimes(11);
  });
  it("keeps existing samples and writes only missing ones", async () => {
    const existing = sampleMedia(2026)[0];
    if (!existing) throw new Error("Missing sample");
    const repo: MediaRepository = {
      load: vi.fn(async () => ({
        records: [{ id: "one", url: null, etag: null, data: existing }],
        incomplete: false,
      })),
      save: vi.fn(async (data) => ({ id: data.title, url: null, etag: null, data })),
    };
    await ensureMediaSample(repo, "demo", new Date("2026-01-01"));
    expect(repo.save).toHaveBeenCalledTimes(9);
  });
  it("seeds the real demo pod, registers Media in its Type Index and survives a reload", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.UTC(2026, 10, 11)),
    });
    const repo = await createMediaRepository({
      knownSolid: true,
      fetch: pod.fetch,
      storage: DEMO_ROOT,
      webId: DEMO_WEBID,
    });
    await ensureMediaSample(repo, "demo", new Date("2026-11-11"));
    const loaded = await repo.load();
    expect(loaded.records).toHaveLength(10);
    expect(loaded.records.every((record) => record.url?.startsWith(`${DEMO_ROOT}media/`))).toBe(
      true,
    );
    const next = await createMediaRepository({
      knownSolid: true,
      fetch: pod.fetch,
      storage: DEMO_ROOT,
      webId: DEMO_WEBID,
    });
    await ensureMediaSample(next, "demo", new Date("2026-11-11"));
    expect((await next.load()).records).toHaveLength(10);
  });
});
