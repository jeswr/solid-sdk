// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { storageUsage } from "../src/apps/home/state/storage-usage";

const root = "https://pod.example/alice/";
it("uses nested listing sizes, never response lengths or downloaded discovery documents", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (input) =>
      new Response(
        String(input) === root
          ? "<> <http://www.w3.org/ns/ldp#contains> <nested/>, <file>. <file> <http://www.w3.org/ns/posix/stat#size> 7."
          : "<> <http://www.w3.org/ns/ldp#contains> <large.bin>. <large.bin> <http://www.w3.org/ns/posix/stat#size> 1048576.",
        { headers: { "content-type": "text/turtle", "content-length": "1" } },
      ),
  );
  expect(await storageUsage(fetch, root)).toBe(1048583);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([
  "missing",
  "invalid",
  "unreadable",
  "truncated",
])("reports usage unavailable when metadata accounting is %s", async (kind) => {
  let reads = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    reads++;
    if (kind === "unreadable") return new Response(null, { status: 403 });
    const turtle =
      kind === "truncated"
        ? `<> <http://www.w3.org/ns/ldp#contains> <${root}nested-${reads}/>.`
        : `<> <http://www.w3.org/ns/ldp#contains> <file>. ${kind === "invalid" ? '<file> <http://www.w3.org/ns/posix/stat#size> "NaN".' : ""}`;
    return new Response(turtle, { headers: { "content-type": "text/turtle" } });
  });
  expect(await storageUsage(fetch, root)).toBeUndefined();
  if (kind === "truncated") expect(fetch).toHaveBeenCalledTimes(256);
});
it("counts a container listed twice once and ignores container sizes", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (input) =>
      new Response(
        String(input) === root
          ? "<> <http://www.w3.org/ns/ldp#contains> <a/>, <b>. <a/> <http://www.w3.org/ns/posix/stat#size> 4096. <b> a <http://www.w3.org/ns/ldp#BasicContainer>."
          : String(input) === `${root}a/`
            ? `<> <http://www.w3.org/ns/ldp#contains> <${root}b>, <x>. <${root}b> a <http://www.w3.org/ns/ldp#Container>. <x> <http://www.w3.org/ns/posix/stat#size> 5.`
            : '<> <http://www.w3.org/ns/ldp#contains> <y>. <y> <http://www.w3.org/ns/posix/stat#size> "6".',
        { headers: { "content-type": "text/turtle" } },
      ),
  );
  expect(await storageUsage(fetch, root)).toBe(11);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([
  ["outside storage", "<> <http://www.w3.org/ns/ldp#contains> <https://elsewhere.example/x>."],
  [
    "unsafe",
    '<> <http://www.w3.org/ns/ldp#contains> <x>. <x> <http://www.w3.org/ns/posix/stat#size> "99999999999999999999".',
  ],
  [
    "negative",
    "<> <http://www.w3.org/ns/ldp#contains> <x>. <x> <http://www.w3.org/ns/posix/stat#size> -1.",
  ],
])("reports usage unavailable for a %s member", async (_kind, turtle) => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(turtle, { headers: { "content-type": "text/turtle" } }),
  );
  expect(await storageUsage(fetch, root)).toBeUndefined();
});
it("reports usage unavailable when the walk times out or the network fails", async () => {
  const slow = vi.fn<typeof globalThis.fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      ),
  );
  expect(await storageUsage(slow, root, { timeoutMs: 5 })).toBeUndefined();
  expect(
    await storageUsage(vi.fn().mockRejectedValue(new TypeError("offline")), root),
  ).toBeUndefined();
});
