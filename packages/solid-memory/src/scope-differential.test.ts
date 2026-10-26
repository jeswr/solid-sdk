// AUTHORED-BY Codex GPT-6.1-Sol
// Frozen pre-migration guard from bfa358b8; kept only as the differential oracle.
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { describe, expect, it } from "vitest";
import { assertWithinBase } from "./index.js";

function legacyAssertWithinBase(
  container: string,
  url: string,
  opts?: { allowRoot?: boolean },
): void {
  const b = new URL(container);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[solid-memory] target URL is invalid: ${url}`);
  }
  // Refuse a target with embedded credentials (https://user:pass@host/…) — the
  // origin/path checks below would pass for the store's own host, but a userinfo
  // component has no business in a target address (it leaks into logs/errors and
  // `fetch` rejects it anyway). Fail closed here, in the one reviewed guard.
  if (u.username !== "" || u.password !== "") {
    throw new Error(
      `[solid-memory] target URL embeds credentials (userinfo refused): ${u.origin}${u.pathname}`,
    );
  }
  if (u.origin !== b.origin) {
    throw new Error(
      `[solid-memory] target URL ${url} escapes container origin ${b.origin} (refused)`,
    );
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(
      `[solid-memory] target URL ${url} escapes container path ${b.pathname} (refused)`,
    );
  }
  // Reject the container ROOT itself for resource CRUD — it is not a managed
  // mem:MemoryItem resource, and acting on it (PUT/DELETE/GET) would target the
  // container document. Compare on the normalised path+origin (ignoring any
  // query/fragment, which a target never carries) so trailing-slash / `?`/`#`
  // variants of the root cannot slip through.
  if (opts?.allowRoot !== true && u.origin === b.origin && u.pathname === b.pathname) {
    throw new Error(
      `[solid-memory] target URL ${url} is the container root, not a managed resource (refused)`,
    );
  }
}

function accepts(check: () => void): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

const bases = [
  "https://pod.example/alice/",
  "https://pod.example:8443/alice/",
  "http://pod.example/alice/",
  "https://[2001:db8::1]/alice/",
  "https://bücher.example/alice/",
  "https://pod.example/",
  "https://pod.example/alice",
  "https://pod.example/alice//",
];

function corpus(base: string): string[] {
  const { origin, pathname } = new URL(base);
  const root = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return [
    base,
    `${origin}${root.slice(0, -1)}`,
    `${origin}${root}?q=1`,
    `${origin}${root}#it`,
    `${origin}${root}item`,
    `${origin}${root}sub/../item`,
    `${origin}${root}./item`,
    `${origin}${root}sub/%2e%2e/item`,
    `${origin}${root}%2e%2e/secret`,
    `${origin}${root}%2E%2E/secret`,
    `${origin}${root}.%2e/secret`,
    `${origin}${root}../secret`,
    `${origin}${root}sub/../../secret`,
    `${origin}${root}..\\secret`,
    `${origin}${root}sub\\..\\item`,
    `${origin}${root}..%2fsecret`,
    `${origin}${root}..%2Fsecret`,
    `${origin}${root}..%5csecret`,
    `${origin}${root}..%5Csecret`,
    `${origin}${root}%252e%252e%252fsecret`,
    `${origin}${root}item%20name`,
    `${origin}${root}item?q=../secret&next=https://evil.example/`,
    `${origin}${root}item#../secret`,
    `${origin}${root}?next=%2fsecret`,
    `${origin}${root}#%5csecret`,
    `${origin}/alice2/item`,
    `${origin}/alice-evil/item`,
    `${origin}/Alice/item`,
    `${origin.replace("://", "://fixture-user:fixture-pass@")}${root}item`,
    `${origin.replace("://", "://fixture-user@")}${root}item`,
    "https://pod.example:443/alice/item",
    "https://pod.example:8443/alice/item",
    "http://pod.example/alice/item",
    "https://evil.example/alice/item",
    "https://pod.example.evil.example/alice/item",
    "https://[2001:db8::2]/alice/item",
    "https://xn--bcher-kva.example/alice/item",
    "https://bücher.example/alice/item",
    "https://[2001:0db8:0:0:0:0:0:1]/alice/item",
    "https://POD.EXAMPLE/alice/item",
    "file:///alice/item",
    "data:text/plain,item",
    "javascript:alert(1)",
    `//${new URL(base).host}${root}item`,
    "item",
    "./item",
    "../secret",
    "/alice/item",
    "?q=1",
    "#it",
    "",
    "   ",
    "http://",
    "::::not a url",
  ];
}

for (const base of bases) {
  for (const allowRoot of [undefined, false, true]) {
    describe(`scope differential: ${base}, allowRoot=${allowRoot}`, () => {
      it.each(corpus(base))("never accepts a legacy rejection: %s", (url) => {
        const oldAccepted = accepts(() => legacyAssertWithinBase(base, url, { allowRoot }));
        const newAccepted = accepts(() => assertWithinBase(base, url, { allowRoot }));
        if (!oldAccepted) expect(newAccepted).toBe(false);
      });
    });
  }
}

it("keeps the public absolute-URL and slash-terminated root contracts", () => {
  const base = "https://pod.example/alice/";
  // These shared-primitive conveniences must NOT widen the old public API.
  expect(assertWithinPodScope(base, "item")).toBe(`${base}item`);
  expect(assertWithinPodScope(base, base.slice(0, -1))).toBe(base.slice(0, -1));
  expect(() => assertWithinBase(base, "item")).toThrow();
  expect(() => assertWithinBase(base, base.slice(0, -1), { allowRoot: true })).toThrow();
  expect(() => assertWithinBase(base, base)).toThrow();
  expect(() => assertWithinBase(base, base, { allowRoot: true })).not.toThrow();
});

it.each([
  "..%2fsecret",
  "..%2Fsecret",
  "..%5csecret",
  "..%5Csecret",
])("tightens ambiguous encoded delimiters: %s", (suffix) => {
  const base = "https://pod.example/alice/";
  expect(() => legacyAssertWithinBase(base, base + suffix)).not.toThrow();
  expect(() => assertWithinBase(base, base + suffix)).toThrow();
});

it.each([
  "item",
  "sub/../item",
  "sub/%2e%2e/item",
  "item?q=1#it",
])("still accepts ordinary scoped resources: %s", (suffix) => {
  for (const base of bases.slice(0, 5)) {
    expect(() => assertWithinBase(base, base + suffix)).not.toThrow();
  }
});
