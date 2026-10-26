// AUTHORED-BY Codex GPT-6.1-Sol
// Frozen pre-migration guard from bfa358b8; kept only as the differential oracle.
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { describe, expect, it } from "vitest";
import { assertWithinBase } from "../src/keys.js";

function legacyAssertWithinBase(base: string, url: string): void {
  const b = new URL(base);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[unstorage-solid] resolved URL is invalid: ${url}`);
  }
  if (u.origin !== b.origin) {
    throw new Error(
      `[unstorage-solid] resolved URL ${url} escapes base origin ${b.origin} (refused)`,
    );
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(
      `[unstorage-solid] resolved URL ${url} escapes base path ${b.pathname} (refused)`,
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
  describe(`scope differential: ${base}`, () => {
    it.each(corpus(base))("never accepts a legacy rejection: %s", (url) => {
      const oldAccepted = accepts(() => legacyAssertWithinBase(base, url));
      const newAccepted = accepts(() => assertWithinBase(base, url));
      if (!oldAccepted) expect(newAccepted).toBe(false);
    });
  });
}

it("keeps the absolute-URL and slash-terminated root contracts", () => {
  const base = "https://pod.example/alice/";
  expect(assertWithinPodScope(base, "item")).toBe(`${base}item`);
  expect(assertWithinPodScope(base, base.slice(0, -1))).toBe(base.slice(0, -1));
  expect(() => assertWithinBase(base, "item")).toThrow();
  expect(() => assertWithinBase(base, base.slice(0, -1))).toThrow();
  expect(() => assertWithinBase(base, base)).not.toThrow();
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

it("refuses userinfo accepted by the legacy guard", () => {
  const base = "https://pod.example/alice/";
  const target = `${base.replace("://", "://fixture-user:fixture-pass@")}item`;
  expect(() => legacyAssertWithinBase(base, target)).not.toThrow();
  expect(() => assertWithinBase(base, target)).toThrow();
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
