// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_VERSIONS,
  MAX_INPUT_VERSIONS,
  type ManagedVersion,
  planRetention,
  RetentionError,
  type RetentionErrorCode,
  type RetentionLimits,
} from "../src/apps/drive/lib/retention";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-26T12:30:00Z");
function version(id: string, createdAt = NOW, sizeBytes = 1, labelled = false): ManagedVersion {
  return { id, createdAt, sizeBytes, labelled };
}
function at(id: string, date: string, labelled = false): ManagedVersion {
  return version(id, Date.parse(date), 1, labelled);
}
function errorCode(invoke: () => unknown, code: RetentionErrorCode): void {
  expect(invoke).toThrowError(RetentionError);
  expect(invoke).toThrowError(`Drive retention: ${code}`);
  try {
    invoke();
  } catch (error) {
    expect(error).toMatchObject({ name: "RetentionError", code });
  }
}

describe("Drive retention age policy", () => {
  it("returns an empty plan and keeps a singleton, including a zero-byte version", () => {
    expect(planRetention([], NOW)).toEqual({
      keep: [],
      delete: [],
      freedBytes: 0,
      overBudget: false,
    });
    expect(planRetention([version("only", NOW, 0)], NOW)).toEqual({
      keep: ["only"],
      delete: [],
      freedBytes: 0,
      overBudget: false,
    });
  });

  it("keeps every version younger than 24 hours, ordered newest first", () => {
    expect(
      planRetention(
        [version("almost-day", NOW - DAY + 1), version("now"), version("recent", NOW - 1)],
        NOW,
      ),
    ).toEqual({
      keep: ["now", "recent", "almost-day"],
      delete: [],
      freedBytes: 0,
      overBudget: false,
    });
  });

  it("keeps the newest per UTC clock hour, rather than rolling age-hour windows", () => {
    const result = planRetention(
      [
        at("old", "2026-10-25T10:10:00Z"),
        at("other-day", "2026-10-24T10:59:00Z"),
        at("next-hour", "2026-10-25T11:00:00Z"),
        at("new", "2026-10-25T10:59:00Z"),
      ],
      NOW,
    );
    expect(result).toEqual({
      keep: ["next-hour", "new", "other-day"],
      delete: ["old"],
      freedBytes: 1,
      overBudget: false,
    });
  });

  it("uses UTC days for 7–30 days, preserving separate dates", () => {
    expect(
      planRetention(
        [
          at("old", "2026-10-15T00:01:00Z"),
          at("prior-day", "2026-10-14T23:59:00Z"),
          at("new", "2026-10-15T23:59:00Z"),
        ],
        NOW,
      ),
    ).toEqual({
      keep: ["new", "prior-day"],
      delete: ["old"],
      freedBytes: 1,
      overBudget: false,
    });
  });

  it("groups ISO weeks across the year boundary, separating Sunday from Monday", () => {
    expect(
      planRetention(
        [
          at("december", "2025-12-30T23:00:00Z"),
          at("sunday", "2026-01-04T23:59:59Z"),
          at("previous-week", "2025-12-28T23:59:59Z"),
          at("monday", "2026-01-05T00:00:00Z"),
        ],
        Date.parse("2026-03-01T00:00:00Z"),
      ),
    ).toEqual({
      keep: ["monday", "sunday", "previous-week"],
      delete: ["december"],
      freedBytes: 1,
      overBudget: false,
    });
  });

  it("separates identically numbered weeks in different ISO years", () => {
    expect(
      planRetention([at("2025", "2024-12-30T00:00:00Z"), at("2026", "2025-12-29T00:00:00Z")], NOW)
        .keep,
    ).toEqual(["2026", "2025"]);
  });

  it("handles leap days and pre-epoch Monday boundaries without the host timezone", () => {
    expect(
      planRetention(
        [
          at("leap", "2024-02-29T23:59:59Z"),
          at("sunday", "2024-03-03T23:59:59Z"),
          at("monday", "2024-03-04T00:00:00Z"),
        ],
        NOW,
      ).delete,
    ).toEqual(["leap"]);
    expect(
      planRetention(
        [
          at("december", "1969-12-29T00:00:00Z"),
          at("sunday", "1970-01-04T23:59:59Z"),
          at("previous-week", "1969-12-28T23:59:59Z"),
          at("monday", "1970-01-05T00:00:00Z"),
        ],
        Date.parse("1970-03-01T00:00:00Z"),
      ).keep,
    ).toEqual(["monday", "sunday", "previous-week"]);
  });

  it("starts hourly thinning at exactly 24 hours and daily thinning at exactly 7 days", () => {
    expect(
      planRetention(
        [
          version("young", NOW - DAY + 1),
          version("24h", NOW - DAY),
          version("24h-plus", NOW - DAY - 1),
          version("7d-minus", NOW - 7 * DAY + 1),
          version("7d", NOW - 7 * DAY),
          version("7d-plus", NOW - 7 * DAY - 1),
        ],
        NOW,
      ),
    ).toEqual({
      keep: ["young", "24h", "7d-minus", "7d"],
      delete: ["24h-plus", "7d-plus"],
      freedBytes: 2,
      overBudget: false,
    });
  });

  it("keeps exactly 30 days in the daily band and starts weekly thinning after it", () => {
    expect(
      planRetention(
        [
          version("30d-minus", NOW - 30 * DAY + 1),
          version("30d", NOW - 30 * DAY),
          version("30d-plus", NOW - 30 * DAY - 1),
          version("30d-plus-two", NOW - 30 * DAY - 2),
        ],
        NOW,
      ),
    ).toEqual({
      keep: ["30d-minus", "30d-plus"],
      delete: ["30d", "30d-plus-two"],
      freedBytes: 2,
      overBudget: false,
    });
  });

  it("retains all labels, with labelled versions still participating in bucket selection", () => {
    const result = planRetention(
      [
        at("label-old", "2026-10-15T00:01:00Z", true),
        at("unlabelled-winner", "2026-10-15T23:59:00Z"),
        at("label-winner", "2026-10-14T23:59:00Z", true),
        at("unlabelled-old", "2026-10-14T00:01:00Z"),
        at("another-label", "2026-10-14T00:00:00Z", true),
      ],
      NOW,
    );
    expect(result.keep).toEqual([
      "unlabelled-winner",
      "label-old",
      "label-winner",
      "another-label",
    ]);
    expect(result.delete).toEqual(["unlabelled-old"]);
  });

  it("breaks timestamp ties lexicographically in buckets and both output arrays", () => {
    const old = NOW - 2 * DAY;
    const input = [
      version("z", old),
      version("a", old),
      version("A", old),
      version("ä", old),
      version("recent-z"),
      version("recent-a"),
    ];
    const expected = {
      keep: ["recent-a", "recent-z", "A"],
      delete: ["a", "z", "ä"],
      freedBytes: 3,
      overBudget: false,
    };
    expect(planRetention(input, NOW)).toEqual(expected);
    expect(planRetention(input.toReversed(), NOW)).toEqual(expected);
    expect(planRetention(input.slice(2).concat(input.slice(0, 2)), NOW)).toEqual(expected);
  });

  it("accepts literal opaque ids without trimming, normalizing or prototype-key collisions", () => {
    const ids = ["", " a ", "__proto__", "constructor", "a", "é", "e\u0301"];
    expect(
      planRetention(
        ids.map((id) => version(id)),
        NOW,
      ).keep,
    ).toEqual(ids.toSorted());
  });

  it("does not mutate frozen inputs or share mutable output arrays between calls", () => {
    const versions = Object.freeze([
      Object.freeze(version("older", NOW - 1)),
      Object.freeze(version("newest")),
    ]);
    const limits = Object.freeze({ maxVersions: 1 });
    const first = planRetention(versions, NOW, limits);
    expect(first).toEqual(planRetention(versions, NOW, limits));
    first.keep.push("changed");
    first.delete.push("changed");
    expect(planRetention(versions, NOW, limits).keep).toEqual(["newest"]);
    expect(versions.map((item) => item.id)).toEqual(["older", "newest"]);
  });
});

describe("Drive retention budgets", () => {
  it("exports the specified defaults, accepting 100 candidates and pruning candidate 101", () => {
    expect(DEFAULT_MAX_VERSIONS).toBe(100);
    expect(DEFAULT_MAX_BYTES).toBe(1_073_741_824);
    const versions = Array.from({ length: DEFAULT_MAX_VERSIONS + 1 }, (_, i) =>
      version(String(i), NOW - i),
    );
    const atBound = planRetention(versions.slice(0, -1), NOW);
    expect(atBound.keep).toHaveLength(DEFAULT_MAX_VERSIONS);
    expect(atBound.delete).toEqual([]);
    expect(atBound.overBudget).toBe(false);
    const above = planRetention(versions, NOW);
    expect(above.keep).toHaveLength(DEFAULT_MAX_VERSIONS);
    expect(above.delete).toEqual(["100"]);
    expect(above.freedBytes).toBe(1);
    expect(above.overBudget).toBe(false);
  });

  it("accepts exactly 1 GiB and prunes the oldest candidate one byte over", () => {
    const latest = version("newest", NOW, DEFAULT_MAX_BYTES);
    expect(planRetention([latest], NOW).overBudget).toBe(false);
    expect(planRetention([version("old", NOW - 1), latest], NOW)).toEqual({
      keep: ["newest"],
      delete: ["old"],
      freedBytes: 1,
      overBudget: false,
    });
    expect(planRetention([version("oversized", NOW, DEFAULT_MAX_BYTES + 1)], NOW)).toEqual({
      keep: ["oversized"],
      delete: [],
      freedBytes: 0,
      overBudget: true,
    });
  });

  it("prunes oldest candidates until both limits hold, including recent candidates", () => {
    expect(
      planRetention(
        [
          version("old", NOW - 3, 3),
          version("middle", NOW - 2, 4),
          version("newer", NOW - 1, 5),
          version("newest", NOW, 6),
        ],
        NOW,
        { maxVersions: 3, maxBytes: 11 },
      ),
    ).toEqual({
      keep: ["newest", "newer"],
      delete: ["middle", "old"],
      freedBytes: 7,
      overBudget: false,
    });
  });

  it("thins by age before applying budgets and counts all deleted bytes once", () => {
    expect(
      planRetention(
        [
          version("recent", NOW, 2),
          version("hour-new", NOW - 2 * DAY, 3),
          version("hour-old", NOW - 2 * DAY - 1, 4),
          version("day", NOW - 10 * DAY, 5),
        ],
        NOW,
        { maxVersions: 1 },
      ),
    ).toEqual({
      keep: ["recent"],
      delete: ["hour-new", "hour-old", "day"],
      freedBytes: 12,
      overBudget: false,
    });
  });

  it("keeps all labels without consuming the unlabelled pruning allowance", () => {
    expect(
      planRetention([version("newest", NOW, 3), version("label", NOW - 1, 4, true)], NOW, {
        maxVersions: 1,
        maxBytes: 3,
      }),
    ).toEqual({
      keep: ["newest", "label"],
      delete: [],
      freedBytes: 0,
      overBudget: true,
    });
    expect(
      planRetention(
        [version("newest"), version("other", NOW - 1), version("label", NOW - 2, 1, true)],
        NOW,
        { maxVersions: 2, maxBytes: 2 },
      ).keep,
    ).toEqual(["newest", "other", "label"]);
  });

  it("reports labelled count and bytes exceeding limits, with no deletions", () => {
    const versions = [version("a", NOW, 2, true), version("b", NOW - 1, 3, true)];
    expect(planRetention(versions, NOW, { maxVersions: 1 }).overBudget).toBe(true);
    expect(planRetention(versions, NOW, { maxVersions: 2, maxBytes: 4 }).overBudget).toBe(true);
    expect(planRetention(versions, NOW, { maxVersions: 2, maxBytes: 5 }).overBudget).toBe(false);
    expect(planRetention(versions, NOW, { maxVersions: 0, maxBytes: 0 }).delete).toEqual([]);
  });

  it("never deletes the newest, including under zero budgets and timestamp ties", () => {
    expect(
      planRetention([version("c"), version("b"), version("a")], NOW, {
        maxVersions: 0,
        maxBytes: 0,
      }),
    ).toEqual({
      keep: ["a"],
      delete: ["b", "c"],
      freedBytes: 2,
      overBudget: true,
    });
    expect(planRetention([], NOW, { maxVersions: 0, maxBytes: 0 }).overBudget).toBe(false);
    expect(
      planRetention([version("zero", NOW, 0)], NOW, { maxVersions: 1, maxBytes: 0 }).overBudget,
    ).toBe(false);
    expect(
      planRetention([version("ancient", NOW - 400 * DAY)], NOW, { maxVersions: 0 }).keep,
    ).toEqual(["ancient"]);
  });

  it("skips labels and versions already thinned when pruning under persistent pressure", () => {
    expect(
      planRetention(
        [
          version("latest", NOW, 5),
          version("label", NOW - 1, 5, true),
          version("candidate", NOW - 2 * DAY, 5),
          version("thinned", NOW - 2 * DAY - 1, 5),
        ],
        NOW,
        { maxBytes: 0 },
      ),
    ).toEqual({
      keep: ["latest", "label"],
      delete: ["candidate", "thinned"],
      freedBytes: 10,
      overBudget: true,
    });
  });

  it("uses exact aggregate arithmetic and rejects unrepresentable freedBytes", () => {
    const huge = Number.MAX_SAFE_INTEGER;
    expect(
      planRetention([version("latest", NOW, huge), version("old", NOW - 1)], NOW, {
        maxBytes: huge,
      }),
    ).toEqual({ keep: ["latest"], delete: ["old"], freedBytes: 1, overBudget: false });
    expect(
      planRetention([version("latest", NOW, 0), version("old", NOW - 1, huge)], NOW, {
        maxBytes: 0,
      }).freedBytes,
    ).toBe(huge);
    errorCode(
      () =>
        planRetention(
          [version("latest", NOW, 0), version("huge", NOW - 1, huge), version("one", NOW - 2)],
          NOW,
          { maxBytes: 0 },
        ),
      "INVALID_VERSION",
    );
    expect(
      planRetention([version("a", NOW, huge, true), version("b", NOW - 1, huge, true)], NOW)
        .overBudget,
    ).toBe(true);
  });
});

describe("Drive retention fail-closed validation", () => {
  it("accepts exactly the input bound with real, distinct records", () => {
    expect(MAX_INPUT_VERSIONS).toBe(100_000);
    const versions = Array.from({ length: MAX_INPUT_VERSIONS }, (_, i) =>
      version(String(i), NOW - i),
    );
    const result = planRetention(versions, NOW, { maxVersions: MAX_INPUT_VERSIONS });
    expect(result.keep).toHaveLength(MAX_INPUT_VERSIONS);
    expect(result.delete).toEqual([]);
    expect(result.overBudget).toBe(false);
  });

  it("rejects bound+1 before touching any records, copying, sorting or validating options", () => {
    const versions = new Proxy(new Array(MAX_INPUT_VERSIONS + 1), {
      get(target, key, receiver) {
        if (key !== "length") throw new Error("must not inspect input");
        return Reflect.get(target, key, receiver);
      },
    });
    errorCode(() => planRetention(versions, Number.NaN), "TOO_MANY_VERSIONS");
  });

  it("rejects duplicate opaque ids, regardless of differences in their other fields", () => {
    errorCode(
      () => planRetention([version("same"), version("same", NOW - DAY, 0, true)], NOW),
      "DUPLICATE_VERSION",
    );
    errorCode(() => planRetention([version(""), version("")], NOW), "DUPLICATE_VERSION");
  });

  it.each([null, undefined, {}, "versions", 1])("rejects a non-array list: %j", (input) => {
    errorCode(() => planRetention(input as ManagedVersion[], NOW), "INVALID_VERSION");
  });

  it.each([
    null,
    undefined,
    {},
    [],
    "version",
    1,
    new Date(),
  ])("rejects malformed version records: %j", (input) => {
    errorCode(() => planRetention([input as ManagedVersion], NOW), "INVALID_VERSION");
  });

  it.each([
    { id: 1 },
    { id: null },
    { createdAt: NOW + 1 },
    { createdAt: 1.5 },
    { createdAt: Number.NaN },
    { createdAt: Number.POSITIVE_INFINITY },
    { createdAt: Number.MIN_SAFE_INTEGER - 1 },
    { createdAt: "2026-10-26" },
    { createdAt: null },
    { sizeBytes: -1 },
    { sizeBytes: 0.5 },
    { sizeBytes: Number.NaN },
    { sizeBytes: Number.NEGATIVE_INFINITY },
    { sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { sizeBytes: "1" },
    { labelled: "false" },
    { labelled: 1 },
    { labelled: undefined },
  ])("rejects invalid version fields: %j", (fields) => {
    errorCode(
      () => planRetention([{ ...version("private-id"), ...fields } as ManagedVersion], NOW),
      "INVALID_VERSION",
    );
  });

  it("rejects missing fields and sparse arrays", () => {
    for (const key of ["id", "createdAt", "sizeBytes", "labelled"] as const) {
      const partial: Partial<ManagedVersion> = { ...version("id") };
      delete partial[key];
      errorCode(() => planRetention([partial as ManagedVersion], NOW), "INVALID_VERSION");
    }
    errorCode(() => planRetention(new Array(1), NOW), "INVALID_VERSION");
  });

  it.each([
    null,
    undefined,
    "now",
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
  ])("rejects invalid injected times even for an empty list: %j", (now) => {
    errorCode(() => planRetention([], now as number), "INVALID_VERSION");
  });

  it.each([
    null,
    [],
    new Date(),
    1,
    { maxVersions: -1 },
    { maxVersions: 1.5 },
    { maxVersions: Number.NaN },
    { maxVersions: Number.POSITIVE_INFINITY },
    { maxVersions: Number.MAX_SAFE_INTEGER + 1 },
    { maxVersions: "100" },
    { maxVersions: null },
    { maxBytes: -1 },
    { maxBytes: 1.5 },
    { maxBytes: Number.NaN },
    { maxBytes: Number.POSITIVE_INFINITY },
    { maxBytes: Number.MAX_SAFE_INTEGER + 1 },
    { maxBytes: "1024" },
    { maxBytes: null },
    { maxbytes: 0 },
  ])("rejects malformed limits rather than reinterpreting them: %j", (limits) => {
    errorCode(() => planRetention([], NOW, limits as RetentionLimits), "INVALID_VERSION");
  });

  it("rejects unknown keys, symbols, hidden properties, and accessors without calling them", () => {
    const accessor = Object.defineProperty({}, "maxBytes", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const hidden = Object.defineProperty({}, "maxBytes", { value: 0 });
    for (const limits of [accessor, hidden, { [Symbol("unknown")]: 0 }]) {
      errorCode(() => planRetention([], NOW, limits), "INVALID_VERSION");
    }
    errorCode(
      () => planRetention([{ ...version("id"), extra: true } as ManagedVersion], NOW),
      "INVALID_VERSION",
    );
  });

  it("accepts plain records without prototypes and omitted optional limits", () => {
    const input = Object.assign(Object.create(null), version("id"));
    const limits = Object.create(null);
    expect(planRetention([input], NOW, limits).keep).toEqual(["id"]);
    expect(
      planRetention([input], NOW, {
        maxVersions: undefined,
        maxBytes: undefined,
      } as unknown as RetentionLimits).keep,
    ).toEqual(["id"]);
  });

  it("accepts safe-integer timestamp extremes without Date clipping or subtraction overflow", () => {
    expect(planRetention([version("epoch", 0)], 0).keep).toEqual(["epoch"]);
    expect(
      planRetention(
        [version("min", Number.MIN_SAFE_INTEGER), version("max", Number.MAX_SAFE_INTEGER)],
        Number.MAX_SAFE_INTEGER,
      ).keep,
    ).toEqual(["max", "min"]);
  });

  it("never includes private identifiers in error messages", () => {
    const input = [version("https://pod.example.org/private-version", NOW + 1)];
    expect(() => planRetention(input, NOW)).toThrowError(/^Drive retention: INVALID_VERSION$/);
  });
  it("reads each field once and maps reflection traps to typed errors", () => {
    // Proxy reporting a key it has no descriptor for (no native TypeError escapes).
    const phantom = new Proxy({}, { ownKeys: () => ["maxBytes"] });
    errorCode(() => planRetention([], NOW, phantom as RetentionLimits), "INVALID_VERSION");
    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    errorCode(() => planRetention([trap as ManagedVersion], NOW), "INVALID_VERSION");
    const throwingArray = new Proxy([version("a")], {
      getOwnPropertyDescriptor(target, key) {
        if (key === "0") throw new Error("trap");
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    errorCode(() => planRetention(throwingArray, NOW), "INVALID_VERSION");
    const accessor = [version("a")];
    Object.defineProperty(accessor, "0", { get: () => version("a"), enumerable: true });
    errorCode(() => planRetention(accessor, NOW), "INVALID_VERSION");
    for (const length of [{ valueOf: () => 0 }, Symbol("length"), -1]) {
      const lying = new Proxy([] as ManagedVersion[], {
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return key === "length" ? { ...descriptor, value: length } : descriptor;
        },
      });
      errorCode(() => planRetention(lying, NOW), "INVALID_VERSION");
    }
    let reads = 0;
    const shifting = new Proxy(version("a", NOW, 1), {
      get(target, key, receiver) {
        reads++;
        return key === "sizeBytes" ? -1 : Reflect.get(target, key, receiver);
      },
    });
    expect(planRetention([shifting], NOW)).toEqual({
      keep: ["a"],
      delete: [],
      freedBytes: 0,
      overBudget: false,
    });
    expect(reads).toBe(0);
  });
});
