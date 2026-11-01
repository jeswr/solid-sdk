// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { type FileImportAdapter, type ImportFile, runFileImport } from "./file-import.js";
import { TEST_POD_ROOT } from "./testing.js";
import type { ConnectorState, PodWriter } from "./types.js";
import { CLASSES, MusicRecording } from "./vocab.js";

const reason = new Error("cancelled by user");

const file: ImportFile = {
  name: "songs.csv",
  size: 10,
  type: "text/csv",
  text: async () => "title\nDemo Song\n",
};

/** A file adapter that writes one document; it never looks at ctx.signal. */
const adapter: FileImportAdapter = {
  metadata: {
    id: "toy",
    name: "Toy",
    tier: "C",
    authKind: "export-file",
    scopes: [],
    categories: ["media"],
    whatYouGet: "One song.",
    requirements: [],
  },
  accept: ".csv",
  fileHint: "Choose songs.csv.",
  async importFile(_file, ctx) {
    const dataset = new Store();
    const song = new MusicRecording(
      `${TEST_POD_ROOT}integrations/toy/music/songs.ttl#song-1`,
      dataset,
      DataFactory,
    ).mark();
    song.name = "Demo Song";
    await ctx.write({
      slug: "music/songs.ttl",
      category: "media",
      forClass: CLASSES.MusicRecording,
      dataset,
    });
  },
};

/** Resolves `started` when the paused call starts; it continues only after `release()`. */
function pause() {
  let reached!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { started, reached: () => reached(), released, release: () => release() };
}

/** A custom PodWriter recording every port call, pausing at the named one. */
function ports(pausedAt: string, gate: ReturnType<typeof pause>) {
  const calls: string[] = [];
  const hold = async (call: string) => {
    calls.push(call);
    if (call === pausedAt) {
      gate.reached();
      await gate.released;
    }
  };
  const podWriter: PodWriter = {
    resolve: (slug) => `https://memory.test/${slug}`,
    read: async (slug) => {
      await hold(`read ${slug}`);
      return undefined;
    },
    write: async (doc) => {
      await hold(`write ${doc.slug}`);
      return {
        url: `https://memory.test/${doc.slug}`,
        category: doc.category,
        forClass: doc.forClass,
      };
    },
    registerType: async () => {
      await hold("register");
      return { indexUrl: "https://memory.test/index" };
    },
  };
  return { calls, podWriter };
}

describe("runFileImport checks cancellation at the Pod writer boundary", () => {
  it.each([
    ["the session's implicit read", "read music/songs.ttl", ["read music/songs.ttl"]],
    [
      "Type Index registration",
      "register",
      ["read music/songs.ttl", "write music/songs.ttl", "register"],
    ],
    [
      "finish()'s provenance read",
      "read _provenance.ttl",
      ["read music/songs.ttl", "write music/songs.ttl", "register", "read _provenance.ttl"],
    ],
  ] as const)("sends no write when cancelled during %s and reports cancelled", async (_name, pausedAt, expected) => {
    const controller = new AbortController();
    const gate = pause();
    const { calls, podWriter } = ports(pausedAt, gate);
    const states: ConnectorState[] = [];
    const previous: ConnectorState = {
      connectedAt: "2026-01-01T00:00:00.000Z",
      lastSync: "2026-01-02T00:00:00.000Z",
      lastOutcome: "success",
      counts: { documents: 3, items: 3, skipped: 0 },
    };
    const run = runFileImport({
      adapter,
      file,
      podWriter,
      state: previous,
      signal: controller.signal,
      onState: (state) => states.push(state),
    });
    await gate.started;
    controller.abort(reason);
    gate.release();
    await expect(run).rejects.toBe(reason);
    // Nothing after the paused call: no write, registration or provenance write.
    expect(calls).toEqual(expected);
    // Reported as a failed run that advances nothing.
    expect(states).toEqual([
      { ...previous, lastOutcome: "error", lastSync: previous.lastSync, counts: previous.counts },
    ]);
    // The connector is released (not finalised), so the next run proceeds.
    const next = ports("", pause());
    await expect(
      runFileImport({ adapter, file, podWriter: next.podWriter }),
    ).resolves.toMatchObject({ indexUrl: "https://memory.test/index" });
    expect(next.calls).toContain("write _provenance.ttl");
  });

  it("never calls the adapter for an already-cancelled run", async () => {
    const controller = new AbortController();
    controller.abort(reason);
    const { calls, podWriter } = ports("", pause());
    let called = false;
    await expect(
      runFileImport({
        adapter: {
          ...adapter,
          async importFile() {
            called = true;
          },
        },
        file,
        podWriter,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(called).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects with the abort reason when the cancel surfaces as an adapter error", async () => {
    const controller = new AbortController();
    const gate = pause();
    const { calls, podWriter } = ports("read music/songs.ttl", gate);
    const run = runFileImport({
      adapter: {
        ...adapter,
        async importFile(f, ctx) {
          try {
            await adapter.importFile(f, ctx);
          } catch {
            throw new Error("the export file ended early");
          }
        },
      },
      file,
      podWriter,
      signal: controller.signal,
    });
    await gate.started;
    controller.abort(reason);
    gate.release();
    await expect(run).rejects.toBe(reason);
    expect(calls).toEqual(["read music/songs.ttl"]);
  });

  it("completes a run whose signal is still live, including provenance", async () => {
    const controller = new AbortController();
    const { calls, podWriter } = ports("", pause());
    const states: ConnectorState[] = [];
    await runFileImport({
      adapter,
      file,
      podWriter,
      signal: controller.signal,
      onState: (state) => states.push(state),
    });
    expect(calls).toEqual([
      "read music/songs.ttl",
      "write music/songs.ttl",
      "register",
      "read _provenance.ttl",
      "write _provenance.ttl",
    ]);
    expect(states[0]?.lastOutcome).toBe("success");
  });
});
