// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  createBinarySizer,
  measureUsage,
  totalFromContentRange,
  type UsageSource,
} from "../src/apps/photos/lib/data/usage";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
const PHOTOS = `${ROOT}photos/`;

function source(key: string, contentUrl: string, thumbnailUrl?: string): UsageSource {
  return { key, photo: { name: key, contentUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) } };
}
/** A fetch that answers from a URL table and records every request. */
function scripted(table: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; method: string; range: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      range: new Headers(init?.headers).get("range"),
    });
    const answer = table[url];
    if (!answer) return new Response(null, { status: 404 });
    return answer(init);
  };
  return { fetch, calls };
}

describe("totalFromContentRange", () => {
  it("reads the complete length after the slash", () => {
    expect(totalFromContentRange("bytes 0-0/12345")).toBe(12345);
    expect(totalFromContentRange("bytes */42")).toBe(42);
    expect(totalFromContentRange("BYTES 0-0/7")).toBe(7);
  });
  it("rejects missing, unknown, malformed and unsafe totals", () => {
    expect(totalFromContentRange(null)).toBeUndefined();
    expect(totalFromContentRange("bytes 0-0/*")).toBeUndefined();
    expect(totalFromContentRange("items 0-0/5")).toBeUndefined();
    expect(totalFromContentRange("bytes 0-0/99999999999999999999")).toBeUndefined();
  });
});

describe("createBinarySizer", () => {
  it("measures binaries in the demo pod by HEAD", async () => {
    const pod = createDemoPod({ root: ROOT });
    const url = `${PHOTOS}originals/a.png`;
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(1500),
    });
    const sizer = createBinarySizer(pod.fetch, PHOTOS);
    expect(await sizer.measure(url)).toBe(1500);
    expect(await sizer.measure(`${PHOTOS}originals/missing.png`)).toBeUndefined();
  });

  it("only treats same-origin URLs under the photos root as stored", () => {
    const sizer = createBinarySizer(globalThis.fetch, PHOTOS);
    expect(sizer.inScope(`${PHOTOS}originals/a.png`)).toBe(true);
    expect(sizer.inScope(`${ROOT}private/a.png`)).toBe(false);
    expect(sizer.inScope("https://lh3.googleusercontent.com/a.png")).toBe(false);
    expect(sizer.inScope("https://eve@alice.demo.pod/photos/a.png")).toBe(false);
    expect(sizer.inScope("https://:secret@alice.demo.pod/photos/a.png")).toBe(false);
    expect(sizer.inScope("not a url")).toBe(false);
  });

  it("never sends a request for a URL outside the photos root", async () => {
    const { fetch, calls } = scripted({});
    const sizer = createBinarySizer(fetch, PHOTOS);
    expect(await sizer.measure("https://evil.example/photos/a.png")).toBeUndefined();
    expect(await sizer.measure(`${ROOT}profile/card`)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("falls back to a one-byte range request when HEAD has no length", async () => {
    const partial = `${PHOTOS}originals/partial.jpg`;
    const whole = `${PHOTOS}originals/whole.jpg`;
    const refused = `${PHOTOS}originals/refused.jpg`;
    const nonsense = `${PHOTOS}originals/nonsense.jpg`;
    const noHead = (respond: (init?: RequestInit) => Response) => (init?: RequestInit) =>
      init?.method === "HEAD" ? new Response(null, { status: 200 }) : respond(init);
    const { fetch, calls } = scripted({
      [partial]: noHead(
        () =>
          new Response(new Uint8Array(1), {
            status: 206,
            headers: { "content-range": "bytes 0-0/9000" },
          }),
      ),
      [whole]: noHead(
        () => new Response(new Uint8Array(3), { status: 200, headers: { "content-length": "3" } }),
      ),
      [refused]: noHead(() => new Response(null, { status: 403 })),
      [nonsense]: noHead(
        () =>
          new Response(null, {
            status: 200,
            headers: { "content-length": "-1" },
          }),
      ),
    });
    const sizer = createBinarySizer(fetch, PHOTOS);
    expect(await sizer.measure(partial)).toBe(9000);
    expect(await sizer.measure(whole)).toBe(3);
    expect(await sizer.measure(refused)).toBeUndefined();
    expect(await sizer.measure(nonsense)).toBeUndefined();
    expect(calls.filter((call) => call.url === partial)).toEqual([
      { url: partial, method: "HEAD", range: null },
      { url: partial, method: "GET", range: "bytes=0-0" },
    ]);
  });

  it("reports transport failures as unmeasured but propagates aborts", async () => {
    const url = `${PHOTOS}originals/a.png`;
    const sizer = createBinarySizer(async () => {
      throw new TypeError("offline");
    }, PHOTOS);
    expect(await sizer.measure(url)).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    const aborting = createBinarySizer(async () => {
      throw new DOMException("aborted", "AbortError");
    }, PHOTOS);
    await expect(aborting.measure(url, controller.signal)).rejects.toThrow("aborted");
  });
});

describe("measureUsage", () => {
  const sized = (sizes: Record<string, number>) =>
    scripted(
      Object.fromEntries(
        Object.entries(sizes).map(([path, size]) => [
          `${PHOTOS}${path}`,
          () => new Response(null, { status: 200, headers: { "content-length": String(size) } }),
        ]),
      ),
    );

  it("sums originals and thumbnails, largest first, with external photos last", async () => {
    const { fetch } = sized({
      "originals/big.jpg": 5000,
      "thumbs/big.webp": 100,
      "originals/small.jpg": 200,
      "thumbs/small.webp": 50,
      "originals/tie-b.jpg": 250,
      "originals/tie-a.jpg": 250,
    });
    const report = await measureUsage(
      createBinarySizer(fetch, PHOTOS),
      [
        source("small", `${PHOTOS}originals/small.jpg`, `${PHOTOS}thumbs/small.webp`),
        { ...source("imported", `${PHOTOS}originals/big.jpg`), external: true },
        source("big", `${PHOTOS}originals/big.jpg`, `${PHOTOS}thumbs/big.webp`),
        source("tie-b", `${PHOTOS}originals/tie-b.jpg`),
        source("tie-a", `${PHOTOS}originals/tie-a.jpg`),
        source("google", "https://lh3.googleusercontent.com/x.jpg"),
      ],
      { concurrency: 2 },
    );
    expect(report.items.map((item) => item.key)).toEqual([
      "big",
      "small",
      "tie-a",
      "tie-b",
      "google",
      "imported",
    ]);
    expect(report.items[0]).toEqual({
      key: "big",
      name: "big",
      originalBytes: 5000,
      thumbnailBytes: 100,
      bytes: 5100,
      location: "stored",
      incomplete: false,
    });
    expect(report).toMatchObject({
      totalBytes: 5100 + 250 + 250 + 250,
      storedCount: 4,
      externalCount: 2,
      incompleteCount: 0,
    });
  });

  it("flags photos whose stored binaries could not be measured", async () => {
    const { fetch } = sized({ "originals/kept.jpg": 10, "thumbs/known.webp": 4 });
    const report = await measureUsage(createBinarySizer(fetch, PHOTOS), [
      source("thumb-missing", `${PHOTOS}originals/kept.jpg`, `${PHOTOS}thumbs/gone.webp`),
      source("original-missing", `${PHOTOS}originals/gone.jpg`, `${PHOTOS}thumbs/known.webp`),
      source("foreign-thumb", `${PHOTOS}originals/kept.jpg`, "https://cdn.example/t.webp"),
    ]);
    expect(
      Object.fromEntries(report.items.map((item) => [item.key, [item.bytes, item.incomplete]])),
    ).toEqual({
      "thumb-missing": [10, true],
      "original-missing": [4, true],
      "foreign-thumb": [10, false],
    });
    expect(report.incompleteCount).toBe(2);
  });

  it("returns an empty report without requests", async () => {
    const { fetch, calls } = scripted({});
    expect(await measureUsage(createBinarySizer(fetch, PHOTOS), [])).toEqual({
      items: [],
      totalBytes: 0,
      storedCount: 0,
      externalCount: 0,
      incompleteCount: 0,
    });
    expect(calls).toEqual([]);
  });
});
