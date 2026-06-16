// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { acceptsSpec, describeStorage, parseStorage, unsupportedSpecs } from "../src/storage.js";
import {
  SECTOR_SCHED,
  SPEC_SCHED_100,
  SPEC_SCHED_110,
  SPEC_SCHED_200,
  STORAGE,
  STORAGE_DUAL_READ,
  STORAGE_NO_EXPLICIT_STORAGE,
  STORAGE_NO_SPEC,
  turtleFetch,
} from "./fixtures.js";

const body = (b: string) => ({ body: b, bodyContentType: "text/turtle" as const });

describe("parseStorage", () => {
  it("parses a dual-read storage description", async () => {
    const v = await parseStorage(STORAGE, body(STORAGE_DUAL_READ));
    expect(v.valid).toBe(true);
    expect(v.storage?.id).toBe(STORAGE);
    expect([...(v.storage?.acceptsSpec ?? [])].sort()).toEqual(
      [SPEC_SCHED_100, SPEC_SCHED_110].sort(),
    );
    expect(v.storage?.supportsSector).toEqual([SECTOR_SCHED]);
  });

  it("flags a storage description with no acceptsSpec", async () => {
    const v = await parseStorage(STORAGE, body(STORAGE_NO_SPEC));
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain("storage-missing-accepts-spec");
  });

  it("reports no-storage-description for an empty document", async () => {
    const v = await parseStorage(STORAGE, body("<https://x.example/> a <https://x.example/T> ."));
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("no-storage-description");
  });

  it("reports parse-failed on a malformed Turtle body", async () => {
    const v = await parseStorage(STORAGE, body("this is not turtle @@@ {"));
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("parse-failed");
  });

  it("fetches over the supplied fetch and verifies (the network path)", async () => {
    const v = await parseStorage(STORAGE, { fetch: turtleFetch(STORAGE_DUAL_READ) });
    expect(v.valid).toBe(true);
    expect(v.storage?.acceptsSpec).toContain(SPEC_SCHED_110);
  });

  it("returns fetch-failed when the fetch rejects with a status", async () => {
    const failing: typeof globalThis.fetch = async () =>
      new Response("nope", { status: 404, headers: { "content-type": "text/plain" } });
    const v = await parseStorage("https://alice.pod.example/missing", { fetch: failing });
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("fetch-failed");
  });

  it("classifies a network error (no HTTP status) as fetch-failed, not parse-failed", async () => {
    const networkDown: typeof globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    const v = await parseStorage("https://alice.pod.example/", { fetch: networkDown });
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("fetch-failed");
  });

  it("defaults storage to the description id when no explicit fedreg:storage triple", async () => {
    const v = await parseStorage(STORAGE, body(STORAGE_NO_EXPLICIT_STORAGE));
    expect(v.valid).toBe(true);
    expect(v.storage?.storage).toBe(STORAGE);
  });

  it("classifies a 200 with an unparseable body as parse-failed (not fetch-failed)", async () => {
    const badBody: typeof globalThis.fetch = async () =>
      new Response("@@@ not turtle {", { status: 200, headers: { "content-type": "text/turtle" } });
    const v = await parseStorage("https://alice.pod.example/", { fetch: badBody });
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("parse-failed");
  });
});

describe("describeStorage", () => {
  it("builds a description that round-trips through parseStorage", async () => {
    const built = describeStorage({
      id: STORAGE,
      acceptsSpec: [SPEC_SCHED_100, SPEC_SCHED_110],
      supportsSector: [SECTOR_SCHED],
    });
    const turtle = await built.toString();
    expect(turtle).toContain("fedreg:StorageDescription");

    const v = await parseStorage(STORAGE, body(turtle));
    expect(v.valid).toBe(true);
    expect(v.storage?.acceptsSpec).toContain(SPEC_SCHED_110);
  });

  it("emits a fedreg:storage link when storage differs from the subject id", async () => {
    const built = describeStorage({
      id: "https://registry.example/catalog#alice",
      storage: STORAGE,
      acceptsSpec: [SPEC_SCHED_100],
    });
    const v = await parseStorage(
      "https://registry.example/catalog#alice",
      body(await built.toString()),
    );
    expect(v.valid).toBe(true);
    expect(v.storage?.storage).toBe(STORAGE);
  });

  it("throws without an id", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => describeStorage({ acceptsSpec: [] })).toThrow(TypeError);
  });
});

describe("acceptsSpec", () => {
  const storage = { acceptsSpec: [SPEC_SCHED_100, SPEC_SCHED_110] };

  it("returns true for an advertised version (either side of a dual-read window)", () => {
    expect(acceptsSpec(storage, SPEC_SCHED_100)).toBe(true);
    expect(acceptsSpec(storage, SPEC_SCHED_110)).toBe(true);
  });

  it("returns false for an unadvertised version", () => {
    expect(acceptsSpec(storage, SPEC_SCHED_200)).toBe(false);
  });

  it("is exact-IRI (no prefix/loose match)", () => {
    // A version that is a prefix of an accepted one must NOT match.
    expect(
      acceptsSpec({ acceptsSpec: [SPEC_SCHED_110] }, "https://w3id.org/jeswr/sectors/scheduling#1"),
    ).toBe(false);
  });
});

describe("unsupportedSpecs", () => {
  it("returns the wanted versions the storage does not accept", () => {
    const storage = { acceptsSpec: [SPEC_SCHED_100, SPEC_SCHED_110] };
    expect(unsupportedSpecs(storage, [SPEC_SCHED_110, SPEC_SCHED_200])).toEqual([SPEC_SCHED_200]);
  });

  it("returns empty when every wanted version is accepted", () => {
    const storage = { acceptsSpec: [SPEC_SCHED_100, SPEC_SCHED_110] };
    expect(unsupportedSpecs(storage, [SPEC_SCHED_100])).toEqual([]);
  });
});
