// AUTHORED-BY Claude Sonnet 5
//
// DataWriter#loadPodScope RUNTIME SHAPE GUARD (roborev Low @ 6c11868, fixed on
// fix/loadpodscope-shape-guard): the dynamic `import("@jeswr/guarded-fetch")` is cast
// to `PodScopePrimitive` at compile time only — an incompatible installed peer version
// (a renamed/removed export) would otherwise surface as a raw `TypeError` the first
// time the write path calls a missing/non-function member, instead of the fail-closed
// `WriteScopeError` every other guard failure produces. This file stubs the dynamic
// import with malformed module shapes and asserts:
//   - the save is refused with a `WriteScopeError` (never a bare `TypeError`), and
//   - no write (or pre-read) request is ever issued — the guard fires BEFORE any fetch.
//
// A SEPARATE file from data-writer.test.ts on purpose: `vi.mock` here replaces
// `@jeswr/guarded-fetch` for every test in this module, whereas data-writer.test.ts's
// "delegation specifics" suite needs the REAL package to prove delegation is wired.

import type { Store } from "n3";
import { describe, expect, it, vi } from "vitest";

/** A trivial mutator — the guard must fire before this (or any fetch) ever runs. */
function setTitle(value: string) {
  return (graph: Store): undefined => {
    const subj = "https://alice.example/tasks/1#it";
    const titlePred = "http://purl.org/dc/terms/title";
    graph.addQuad(
      { termType: "NamedNode", value: subj } as never,
      { termType: "NamedNode", value: titlePred } as never,
      {
        termType: "Literal",
        value,
        language: "",
        datatype: { termType: "NamedNode", value: "http://www.w3.org/2001/XMLSchema#string" },
      } as never,
    );
    return undefined;
  };
}

function unusedFetch() {
  return vi.fn(async () => {
    throw new Error("no fetch should ever be issued — the scope guard must fire first");
  });
}

describe("DataWriter#loadPodScope — incompatible @jeswr/guarded-fetch peer shape", () => {
  it("assertWithinPodScope missing entirely → fail-closed WriteScopeError, no fetch issued", async () => {
    vi.doMock("@jeswr/guarded-fetch", () => ({
      // assertWithinPodScope absent
      PodScopeError: class PodScopeError extends Error {},
    }));
    vi.resetModules();
    const { DataWriter: FreshDataWriter, WriteScopeError: FreshWriteScopeError } = await import(
      "../src/data-writer.js"
    );
    const fetch = unusedFetch();
    const dw = new FreshDataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(FreshWriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("@jeswr/guarded-fetch");
    vi.resetModules();
  });

  it("assertWithinPodScope not a function → fail-closed WriteScopeError, no fetch issued", async () => {
    vi.doMock("@jeswr/guarded-fetch", () => ({
      assertWithinPodScope: "not-a-function",
      PodScopeError: class PodScopeError extends Error {},
    }));
    vi.resetModules();
    const { DataWriter: FreshDataWriter, WriteScopeError: FreshWriteScopeError } = await import(
      "../src/data-writer.js"
    );
    const fetch = unusedFetch();
    const dw = new FreshDataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(FreshWriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("@jeswr/guarded-fetch");
    vi.resetModules();
  });

  it("PodScopeError not a constructor → fail-closed WriteScopeError, no fetch issued", async () => {
    vi.doMock("@jeswr/guarded-fetch", () => ({
      assertWithinPodScope: (_base: string, url: string) => url,
      // PodScopeError present but the wrong runtime shape (a plain object, not a class).
      PodScopeError: { notAConstructor: true },
    }));
    vi.resetModules();
    const { DataWriter: FreshDataWriter, WriteScopeError: FreshWriteScopeError } = await import(
      "../src/data-writer.js"
    );
    const fetch = unusedFetch();
    const dw = new FreshDataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(FreshWriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("@jeswr/guarded-fetch");
    vi.resetModules();
  });

  it("the WriteScopeError message names the incompatible peer, not a bare TypeError", async () => {
    vi.doMock("@jeswr/guarded-fetch", () => ({
      assertWithinPodScope: undefined,
      PodScopeError: undefined,
    }));
    vi.resetModules();
    const { DataWriter: FreshDataWriter } = await import("../src/data-writer.js");
    const fetch = unusedFetch();
    const dw = new FreshDataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    await expect(dw.saveMerged("https://alice.example/tasks/1", setTitle("X"))).rejects.toThrow(
      /incompatible @jeswr\/guarded-fetch peer/,
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock("@jeswr/guarded-fetch");
    vi.resetModules();
  });
});
