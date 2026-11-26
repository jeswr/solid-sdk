// AUTHORED-BY Claude Opus 5.5
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@jeswr/solid-listening", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/solid-listening")>();
  return { ...actual, libraryFieldQuads: vi.fn(actual.libraryFieldQuads) };
});

import { libraryFieldQuads } from "@jeswr/solid-listening";
import { InvalidMusicError, MusicNode, Store } from "../../src/apps/music/lib/model";

const iri = "https://pod.test/music/history/2026-10.ttl#play";

afterEach(() => {
  vi.mocked(libraryFieldQuads).mockRestore?.();
});

describe("MusicNode.modelQuads", () => {
  it("rethrows a generated-model Error as InvalidMusicError with its message", () => {
    vi.mocked(libraryFieldQuads).mockImplementationOnce(() => {
      throw new Error("not a valid listen time");
    });
    const node = new MusicNode(iri, new Store());
    expect(() => node.modelQuads("Listen", "startTime", new Date())).toThrow(InvalidMusicError);
    vi.mocked(libraryFieldQuads).mockImplementationOnce(() => {
      throw new Error("not a valid listen time");
    });
    expect(() => node.modelQuads("Listen", "startTime", new Date())).toThrow(
      "not a valid listen time",
    );
  });

  it("wraps a non-Error throw as InvalidMusicError text", () => {
    vi.mocked(libraryFieldQuads).mockImplementationOnce(() => {
      throw "plain refusal";
    });
    const node = new MusicNode(iri, new Store());
    expect(() => node.modelQuads("Listen", "startTime", new Date())).toThrow("plain refusal");
  });

  it("writeIri with undefined clears the link", () => {
    const store = new Store();
    const node = new MusicNode(iri, store);
    node.writeIri("https://schema.org/url", "https://example.org/a");
    expect(node.iris("https://schema.org/url")).toEqual(["https://example.org/a"]);
    node.writeIri("https://schema.org/url", undefined);
    expect(node.iris("https://schema.org/url")).toEqual([]);
  });
});
