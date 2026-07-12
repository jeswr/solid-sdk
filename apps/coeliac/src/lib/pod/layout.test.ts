// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  asContainer,
  assertBarcode,
  assertUlid,
  conclusionUrl,
  containerOf,
  diaryContainers,
  diaryRoot,
  geneticsContainer,
  geneticsSummaryUrl,
  isBarcode,
  mealUrl,
  monthBucket,
  offCacheUrl,
  protocolUrl,
  symptomUrl,
} from "./layout";

const ROOT = "https://alice.example/";

describe("pod layout", () => {
  it("roots the diary under the storage root", () => {
    expect(diaryRoot(ROOT)).toBe("https://alice.example/health/diary/");
    expect(diaryRoot("https://alice.example")).toBe("https://alice.example/health/diary/");
  });

  it("rejects a non-http(s) storage root (fail-closed)", () => {
    expect(() => diaryRoot("ftp://x/")).toThrow();
    expect(() => diaryRoot("not a url")).toThrow();
  });

  it("month-buckets in UTC", () => {
    expect(monthBucket(new Date("2026-07-03T12:00:00Z"))).toBe("2026/07/");
    expect(monthBucket(new Date("2026-01-31T23:30:00Z"))).toBe("2026/01/");
  });

  it("builds meal + symptom URLs in the right month bucket", () => {
    const at = new Date("2026-07-03T12:00:00Z");
    const ulid = "01J000000000000000000000AB";
    expect(mealUrl(ROOT, at, ulid)).toBe(
      `https://alice.example/health/diary/meals/2026/07/${ulid}.ttl`,
    );
    expect(symptomUrl(ROOT, at, ulid)).toBe(
      `https://alice.example/health/diary/symptoms/2026/07/${ulid}.ttl`,
    );
  });

  it("validates ULIDs + barcodes (path-injection guard)", () => {
    expect(() => assertUlid("../../evil")).toThrow();
    expect(() => assertUlid("short")).toThrow();
    expect(assertUlid("01J000000000000000000000AB")).toBe("01J000000000000000000000AB");
    expect(isBarcode("5000159407236")).toBe(true);
    expect(isBarcode("12")).toBe(false);
    expect(isBarcode("50001/../x")).toBe(false);
    expect(() => assertBarcode("../secrets")).toThrow();
  });

  it("keeps the OFF cache URL inside the cache container", () => {
    expect(offCacheUrl(ROOT, "5000159407236")).toBe(
      "https://alice.example/health/diary/cache/off/5000159407236.ttl",
    );
    expect(() => offCacheUrl(ROOT, "../../etc/passwd")).toThrow();
  });

  it("lists the containers to provision (incl. protocols + conclusions)", () => {
    const containers = diaryContainers(ROOT);
    expect(containers).toContain("https://alice.example/health/diary/");
    expect(containers).toContain("https://alice.example/health/diary/meals/");
    expect(containers).toContain("https://alice.example/health/diary/cache/off/");
    expect(containers).toContain("https://alice.example/health/diary/protocols/");
    expect(containers).toContain("https://alice.example/health/diary/conclusions/");
    expect(containers).toContain("https://alice.example/health/diary/genetics/");
  });

  it("keeps the single genetic summary under the genetics container (fixed name, no traversal)", () => {
    expect(geneticsContainer(ROOT)).toBe("https://alice.example/health/diary/genetics/");
    expect(geneticsSummaryUrl(ROOT)).toBe(
      "https://alice.example/health/diary/genetics/summary.ttl",
    );
    // The name is code-supplied + fixed, so the URL always stays under the diary root.
    expect(geneticsSummaryUrl(ROOT).startsWith(diaryRoot(ROOT))).toBe(true);
  });

  it("keeps protocol + conclusion URLs inside their containers (ULID-guarded)", () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    expect(protocolUrl(ROOT, ulid)).toBe(`https://alice.example/health/diary/protocols/${ulid}.ttl`);
    expect(conclusionUrl(ROOT, ulid)).toBe(
      `https://alice.example/health/diary/conclusions/${ulid}.ttl`,
    );
    expect(() => protocolUrl(ROOT, "../../etc/passwd")).toThrow();
    expect(() => conclusionUrl(ROOT, "../secrets")).toThrow();
  });

  it("derives a container from a resource URL", () => {
    expect(containerOf("https://alice.example/health/diary/meals/2026/07/x.ttl")).toBe(
      "https://alice.example/health/diary/meals/2026/07/",
    );
  });

  describe("query/fragment-smuggling regression (podscope-rawstring)", () => {
    it("asContainer uses the PARSED PATH, not a raw-string endsWith(\"/\") check", () => {
      // A raw string ending in "/" via its query/fragment (path does NOT end in "/")
      // must still be normalised on the path, not accepted as-is.
      expect(asContainer("https://alice.example/pod?x=/")).toBe("https://alice.example/pod/");
      expect(asContainer("https://alice.example/pod#/")).toBe("https://alice.example/pod/");
      // And the query/fragment must never survive into the normalised container address.
      expect(asContainer("https://alice.example/pod?x=/")).not.toContain("?");
      expect(asContainer("https://alice.example/pod#/")).not.toContain("#");
    });

    it("diaryRoot resolves the sub-path correctly even from a query/fragment-bearing root (no swallowed suffix)", () => {
      // Before the fix, string-concatenating "health/diary/" onto a root with a
      // surviving query/fragment would land the suffix INSIDE the query/fragment
      // (e.g. "https://alice.example/pod?x=/health/diary/") rather than extending the
      // path — so a fetch to that address would hit "/pod", not "/pod/health/diary/".
      expect(diaryRoot("https://alice.example/pod?x=/")).toBe(
        "https://alice.example/pod/health/diary/",
      );
      expect(diaryRoot("https://alice.example/pod#/")).toBe(
        "https://alice.example/pod/health/diary/",
      );
      // Sub-path resolution off a query/fragment-bearing root is also correct end-to-end.
      const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const at = new Date("2026-07-03T12:00:00Z");
      expect(mealUrl("https://alice.example/pod?x=/", at, ulid)).toBe(
        `https://alice.example/pod/health/diary/meals/2026/07/${ulid}.ttl`,
      );
    });

    it("asContainer still rejects non-http(s), credentialed, and encoded-delimiter bases (fail-closed)", () => {
      expect(() => asContainer("ftp://alice.example/pod/")).toThrow();
      expect(() => asContainer("https://user:pass@alice.example/pod/")).toThrow();
      expect(() => asContainer("https://alice.example/pod%2f../")).toThrow();
    });
  });
});
