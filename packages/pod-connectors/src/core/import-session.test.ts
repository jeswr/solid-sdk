// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createImportSession,
  type ImportSessionOptions,
  MAX_RUN_SOURCES,
} from "./import-session.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { NormalisedDoc, VocabMap } from "./types.js";
import { CLASSES, DataCollection, MusicRecording } from "./vocab.js";

const sessions: ReturnType<typeof createImportSession>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.finish();
});

function setup(vocabMap?: VocabMap, options: ImportSessionOptions = {}) {
  const pod = createMemoryPod();
  const writer = createFetchPodWriter({
    adapterId: "accounting",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const session = createImportSession(
    writer,
    "accounting",
    "urn:synthetic:export",
    options,
    vocabMap,
  );
  sessions.push(session);
  function doc(slug: string, ids: string[], writeMode?: NormalisedDoc["writeMode"]): NormalisedDoc {
    const dataset = new Store();
    const url = writer.resolve(slug);
    new DataCollection(url, dataset, DataFactory).mark();
    for (const id of ids) {
      const item = new MusicRecording(`${url}#${id}`, dataset, DataFactory).mark();
      item.identifier = id;
      item.name = `Synthetic ${id}`;
    }
    return { slug, dataset, writeMode, category: "media", forClass: CLASSES.MusicRecording };
  }
  return { pod, writer, session, doc };
}

describe("bounded run provenance", () => {
  it.each([
    1, 3,
  ])("retains at most %i distinct sources while preserving every derivation", async (cap) => {
    const { pod, writer, session, doc } = setup(undefined, { maxRunSources: cap });
    const source = "urn:synthetic:export";
    const first = "https://source.example/first";
    const second = "https://source.example/second";
    const sources = [first, first, second, "https://source.example/omitted"];
    const expected = [source, first, second].slice(0, cap);
    for (const slug of ["a.ttl", "b.ttl"]) {
      const input = doc(
        slug,
        sources.map((_, i) => String(i)),
        "merge",
      );
      for (const [i, origin] of sources.entries())
        new MusicRecording(`${writer.resolve(slug)}#${i}`, input.dataset, DataFactory).sourceUrl =
          origin;
      await session.write(input);
      await session.write(input);
      expect([...session.used]).toEqual(expected);
      const dataset = pod.dataset(writer.resolve(slug));
      for (const [i, origin] of sources.entries()) {
        expect(
          new Provenance(`${writer.resolve(slug)}#${i}`, dataset, DataFactory).derivedFrom.has(
            origin,
          ),
        ).toBe(true);
        expect(
          new Provenance(writer.resolve(slug), dataset, DataFactory).derivedFrom.has(origin),
        ).toBe(true);
      }
    }
    expect(session.state({}).counts).toEqual({ documents: 2, items: 8, skipped: 0 });
    await session.finish();
    const dataset = pod.dataset(writer.resolve("_provenance.ttl"));
    const [activityUrl] = [
      ...new Provenance(writer.resolve("a.ttl"), pod.dataset(writer.resolve("a.ttl")), DataFactory)
        .generatedBy,
    ];
    if (!activityUrl) throw new Error("Expected the document's run provenance");
    expect([...new Provenance(activityUrl, dataset, DataFactory).used]).toEqual(expected);
  });

  it.each([
    undefined,
    2_000,
  ])("enforces the default ceiling even with option %s", async (maxRunSources) => {
    const { pod, writer, session, doc } = setup(undefined, { maxRunSources });
    const ids = Array.from({ length: MAX_RUN_SOURCES + 3 }, (_, i) => String(i));
    const input = doc("many.ttl", ids);
    for (const id of ids)
      new MusicRecording(
        `${writer.resolve(input.slug)}#${id}`,
        input.dataset,
        DataFactory,
      ).sourceUrl = `https://source.example/${id}`;
    await session.write(input);
    expect(session.used.size).toBe(MAX_RUN_SOURCES);
    expect(session.used.has("urn:synthetic:export")).toBe(true);
    expect(session.used.has(`https://source.example/${MAX_RUN_SOURCES - 2}`)).toBe(true);
    expect(session.used.has(`https://source.example/${MAX_RUN_SOURCES - 1}`)).toBe(false);
    expect(session.state({}).counts.items).toBe(ids.length);
    await session.finish();
    const dataset = pod.dataset(writer.resolve(input.slug));
    const [activityUrl] = [
      ...new Provenance(writer.resolve(input.slug), dataset, DataFactory).generatedBy,
    ];
    if (!activityUrl) throw new Error("Expected the document's run provenance");
    expect(
      new Provenance(activityUrl, pod.dataset(writer.resolve("_provenance.ttl")), DataFactory).used
        .size,
    ).toBe(MAX_RUN_SOURCES);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid limit %s", (maxRunSources) => {
    expect(() => setup(undefined, { maxRunSources })).toThrow(RangeError);
  });
});

describe("document-level import item accounting", () => {
  it("replaces the count with the latest source subjects, including empty replacements", async () => {
    const { writer, session, doc } = setup();
    await session.write(doc("a.ttl", ["one", "two", "three"]));
    expect(session.state({}).counts.items).toBe(3);
    await session.write(doc("b.ttl", ["one"]));
    await session.write(doc("a.ttl", ["two"], "replace"));
    expect(session.state({}).counts).toEqual({ documents: 2, items: 2, skipped: 0 });
    expect([...session.itemCounts]).toEqual([
      [writer.resolve("a.ttl"), 1],
      [writer.resolve("b.ttl"), 1],
    ]);
    await session.write(doc("a.ttl", []));
    expect(session.state({}).counts.items).toBe(1);
    expect(session.itemCounts.get(writer.resolve("a.ttl"))).toBe(0);
  });

  it("deduplicates merges using this run's stored provenance and counts prior-run subjects anew", async () => {
    const { pod, writer, session, doc } = setup();
    const previous = doc("a.ttl", ["old", "untouched"]);
    new Provenance(`${writer.resolve("a.ttl")}#old`, previous.dataset, DataFactory).generatedBy.add(
      "urn:synthetic:previous-run",
    );
    await writer.write(previous);
    await session.write(doc("a.ttl", ["old", "one"], "merge"));
    expect(session.state({}).counts.items).toBe(2);
    await session.write(doc("a.ttl", ["one", "two"], "merge"));
    await session.write(doc("a.ttl", ["old", "two"], "merge"));
    await session.write(doc("a.ttl", [], "merge"));
    expect(session.state({}).counts).toEqual({ documents: 1, items: 3, skipped: 0 });
    expect(session.itemCounts.size).toBe(1);
    expect(
      new MusicRecording(
        `${writer.resolve("a.ttl")}#untouched`,
        pod.dataset(writer.resolve("a.ttl")),
        DataFactory,
      ).name,
    ).toBe("Synthetic untouched");
    await session.finish();
    const nextRun = createImportSession(writer, "accounting", "urn:synthetic:export", {});
    sessions.push(nextRun);
    await nextRun.write(doc("a.ttl", ["old", "one"], "merge"));
    expect(nextRun.state({}).counts.items).toBe(2);
  });

  it("counts the same subject separately in each document", async () => {
    const { writer, session, doc } = setup();
    for (const slug of ["a.ttl", "b.ttl"]) {
      const input = doc(slug, [], "merge");
      new MusicRecording(`${writer.resolve("shared.ttl")}#item`, input.dataset, DataFactory).mark();
      await session.write(input);
      await session.write(input);
    }
    expect(session.state({}).counts.items).toBe(2);
    expect([...session.itemCounts.values()]).toEqual([1, 1]);
  });

  it("excludes external source subjects from counts and generation provenance", async () => {
    const { pod, writer, session, doc } = setup();
    const external = "urn:synthetic:external";
    const input = doc("a.ttl", ["local"], "merge");
    new MusicRecording(external, input.dataset, DataFactory).mark();
    await session.write(input);
    await session.write(input);
    expect(session.state({}).counts.items).toBe(1);
    const provenance = new Provenance(external, pod.dataset(writer.resolve("a.ttl")), DataFactory);
    expect(provenance.generatedBy.size).toBe(0);
    expect(provenance.derivedFrom.size).toBe(0);
  });

  it("resets merge accounting on replacement and removal before accepting later subjects", async () => {
    const { writer, session, doc } = setup();
    await session.write(doc("a.ttl", ["one", "two"], "merge"));
    await session.write(doc("a.ttl", ["two"], "replace"));
    await session.write(doc("a.ttl", ["one", "three"], "merge"));
    await session.write(doc("b.ttl", ["one"]));
    expect(session.state({}).counts.items).toBe(4);
    await session.read("a.ttl");
    await session.remove("a.ttl");
    await session.remove("missing.ttl");
    expect([...session.itemCounts]).toEqual([[writer.resolve("b.ttl"), 1]]);
    expect(session.state({}).counts).toEqual({ documents: 1, items: 1, skipped: 0 });
    await session.write(doc("a.ttl", ["one"], "merge"));
    expect(session.state({}).counts.items).toBe(2);
  });

  it("excludes sector-map-added subjects while recording their provenance", async () => {
    const { pod, writer, session, doc } = setup((input) => {
      new MusicRecording(`${writer.resolve(input.slug)}#mapped`, input.dataset, DataFactory).mark();
      return input;
    });
    const input = doc("a.ttl", ["one", "two"], "merge");
    const size = input.dataset.size;
    await session.write(input);
    await session.write(input);
    expect(input.dataset.size).toBe(size);
    expect(session.state({}).counts.items).toBe(2);
    const dataset = pod.dataset(writer.resolve("a.ttl"));
    expect(
      new Provenance(`${writer.resolve("a.ttl")}#mapped`, dataset, DataFactory).generatedBy.size,
    ).toBe(1);
  });

  it("updates accounting only after successful writes and removals", async () => {
    const { writer, session, doc } = setup();
    const write = vi.spyOn(writer, "write");
    write.mockRejectedValueOnce(new Error("synthetic write failure"));
    await expect(session.write(doc("a.ttl", ["one"]))).rejects.toThrow("write failure");
    expect(session.itemCounts.size).toBe(0);
    await session.write(doc("a.ttl", ["one", "two"]));
    write.mockRejectedValueOnce(new Error("synthetic write failure"));
    await expect(session.write(doc("a.ttl", ["three"]))).rejects.toThrow("write failure");
    expect(session.state({}).counts.items).toBe(2);
    vi.spyOn(writer, "remove").mockRejectedValueOnce(new Error("synthetic remove failure"));
    await expect(session.remove("a.ttl")).rejects.toThrow("remove failure");
    expect(session.state({}).counts).toEqual({ documents: 1, items: 2, skipped: 0 });
    await session.remove("a.ttl");
    expect(session.itemCounts.size).toBe(0);
    expect(session.state({}).counts.items).toBe(0);
  });
});
