// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { useEffect, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  params: { ref: "web-value" } as Record<string, string | string[]>,
  pathname: "/drive/f/a/" as string | null,
  listeners: new Set<() => void>(),
  notFound: false,
}));
vi.mock("next/navigation", () => ({
  // Next's notFound() throws; recording the call lets the probe render its result.
  notFound: () => {
    navigation.notFound = true;
  },
  useParams: () => {
    if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native")
      throw new Error("Native must not read the placeholder router tree");
    return navigation.params;
  },
  usePathname: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.pathname,
    ),
}));

let useRouteParams: typeof import("../src/lib/route-params").useRouteParams;
let usePageRouteParams: typeof import("../src/lib/route-params").usePageRouteParams;
async function loadTarget(target: string) {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", target);
  vi.resetModules();
  ({ useRouteParams, usePageRouteParams } = await import("../src/lib/route-params"));
}

afterEach(() => vi.unstubAllEnvs());

it("passes through reactive web params without remounting or interpreting the pathname", async () => {
  await loadTarget("web");
  let mounts = 0;
  function Probe() {
    const params = useRouteParams("/drive/f/[ref]");
    useEffect(() => {
      mounts++;
    }, []);
    return h("span", null, JSON.stringify(params));
  }
  const view = await mount(h(Probe));
  expect(view.host.textContent).toBe(JSON.stringify(navigation.params));
  navigation.params = { ref: "web-sibling" };
  await view.render(h(Probe));
  expect(view.host.textContent).toBe(JSON.stringify(navigation.params));
  expect(mounts).toBe(1);
});

it("decodes web params once, keeping malformed percent-encoding as it arrived", async () => {
  await loadTarget("web");
  navigation.params = { label: "Work%20stuff", bad: "100%", parts: ["a%2Fb", "%E0%A4%A"] };
  function Probe() {
    return h("span", null, JSON.stringify(useRouteParams("/tasks/l/[label]")));
  }
  const view = await mount(h(Probe));
  expect(JSON.parse(view.host.textContent ?? "")).toEqual({
    label: "Work stuff",
    bad: "100%",
    parts: ["a/b", "%E0%A4%A"],
  });
  navigation.params = { ref: "web-value" };
});

describe("usePageRouteParams", () => {
  function Probe() {
    const params = usePageRouteParams("/tasks/l/[label]");
    const text = navigation.notFound ? "NEXT_NOT_FOUND" : (JSON.stringify(params) ?? "pending");
    return h("span", null, text);
  }

  it("returns web params", async () => {
    await loadTarget("web");
    navigation.params = { label: "a" };
    const view = await mount(h(Probe));
    expect(view.host.textContent).toBe('{"label":"a"}');
    navigation.params = { ref: "web-value" };
  });

  it.each([
    ["/tasks/l/home/", '{"label":"home"}'],
    ["/tasks/l/__/", "pending"],
    [null, "pending"],
    ["/tasks/l/%E0%A4%A/", "NEXT_NOT_FOUND"],
    ["/tasks/l/a/b/", "NEXT_NOT_FOUND"],
  ])("on native maps %s to %s", async (pathname, expected) => {
    await loadTarget("native");
    navigation.notFound = false;
    navigation.pathname = pathname;
    const view = await mount(h(Probe));
    expect(view.host.textContent).toBe(expected);
    navigation.pathname = "/drive/f/a/";
  });
});

it("reads the real native pathname and updates a sibling param on the same mounted component", async () => {
  await loadTarget("native");
  navigation.pathname = "/drive/f/a/";
  navigation.params = { ref: "__" };
  let mounts = 0;
  function Probe() {
    const params = useRouteParams<{ ref: string }>("/drive/f/[ref]");
    useEffect(() => {
      mounts++;
    }, []);
    return h("span", null, params?.ref ?? "Loading…");
  }
  const view = await mount(h(Probe));
  expect(view.host.textContent).toBe("a");
  await act(() => {
    navigation.pathname = "/drive/f/b/";
    for (const listener of navigation.listeners) listener();
  });
  expect(view.host.textContent).toBe("b");
  expect(mounts).toBe(1);
});

it.each([
  ["/drive/f/__", "/drive/f/[ref]", undefined],
  ["/drive/f/%5F%5F", "/drive/f/[ref]", undefined],
  [null, "/drive/f/[ref]", undefined],
  ["/drive/f/", "/drive/f/[ref]", undefined],
  ["/drive/p/a", "/drive/f/[ref]", undefined],
  ["/drive/f/a/extra", "/drive/f/[ref]", undefined],
  ["/drive/f/%", "/drive/f/[ref]", undefined],
  ["/dr%69ve/%66/YQ/", "/drive/f/[ref]", { ref: "YQ" }],
  ["/%64ocs/a/%252F/", "/docs/[...path]", { path: ["a", "%2F"] }],
  ["/dr%2569ve/f/YQ/", "/drive/f/[ref]", undefined],
  ["/dr%FFve/f/YQ/", "/drive/f/[ref]", undefined],
  ["/drive/f/%2F/", "/drive/f/[ref]", undefined],
  ["/docs/a%2Fb/", "/docs/[...path]", undefined],
  ["/drive/f/a%5Cb/", "/drive/f/[ref]", undefined],
  ["/drive/f/a%00b/", "/drive/f/[ref]", undefined],
  ["/drive/f/../", "/drive/f/[ref]", undefined],
  ["/drive/f/./", "/drive/f/[ref]", undefined],
  ["/drive//f/a/", "/drive/f/[ref]", undefined],
  ["drive/f/a", "/drive/f/[ref]", undefined],
  ["/drive/f/a?x=y", "/drive/f/[ref]", undefined],
  [`/drive/f/${"a".repeat(2048)}`, "/drive/f/[ref]", undefined],
  ["/docs/a/b", "/docs/[...path]", { path: ["a", "b"] }],
  ["/docs/a/%5F%5F", "/docs/[...path]", undefined],
  ["/docs/", "/docs/[...path]", undefined],
  ["/docs/", "/docs/[[...path]]", { path: [] }],
  ["/tasks/l/work.2026/", "/tasks/l/[label]", { label: "work.2026" }],
  ["/tasks/l/Caf%C3%A9/", "/tasks/l/[label]", { label: "Café" }],
] as const)("parses native %s against %s", async (pathname, pattern, expected) => {
  await loadTarget("native");
  navigation.pathname = pathname;
  let result: ReturnType<typeof useRouteParams>;
  function Probe() {
    result = useRouteParams(pattern);
    return null;
  }
  await mount(h(Probe));
  expect(result).toEqual(expected);
});

// AUTHORED-BY Claude Opus 5.5
// The hook and scripts/route-resolver.mjs are separate implementations; the shared vectors
// keep them in agreement (transport suffixes stripped, since the hook sees page pathnames).
describe("matchRouteParams agrees with the native resolver vectors", async () => {
  const { readFile } = await import("node:fs/promises");
  const vectors = JSON.parse(
    await readFile(new URL("../../mobile/test/vectors/routes.json", import.meta.url), "utf8"),
  ) as {
    manifest: { routes: { pattern: string; directory: string; files: string[] }[] };
    cases: { request: string; path: string; status: number }[];
  };
  const { matchRouteParams } = await import("../src/lib/route-params");
  const routes = vectors.manifest.routes;
  const owner = (path: string) =>
    routes.find((route) =>
      route.files.some((file) => (route.directory ? `${route.directory}/${file}` : file) === path),
    );
  // A request naming a transport file (index.html, *.txt) is served for its page's pathname.
  const transport = (request: string) => /\/(index\.html|[^/]*\.txt)$/.test(request);
  const page = (request: string) => (transport(request) ? request.replace(/[^/]*$/, "") : request);
  // Static assets have no route; the hook only ever sees page pathnames.
  it.each(
    vectors.cases.filter((c) => c.status === 200 && owner(c.path)),
  )("matches $request like the resolver", ({ request, path }) => {
    expect(matchRouteParams(owner(path)?.pattern ?? "", page(request))).toBeDefined();
  });
  it.each(
    vectors.cases.filter((c) => c.status === 404 && !transport(c.request)),
  )("rejects $request like the resolver", ({ request }) => {
    for (const route of routes) expect(matchRouteParams(route.pattern, request)).toBeUndefined();
  });
});

it("normalises the native export's trailing slash for route comparisons", async () => {
  const { normalizePathname } = await import("../src/lib/route-params");
  expect(normalizePathname("/")).toBe("/");
  expect(normalizePathname("/photos/a/REF/")).toBe("/photos/a/REF");
  expect(normalizePathname("/photos/favourites")).toBe("/photos/favourites");
});

it("reads the pathname without the trailing slash, and the root before the router has one", async () => {
  const { useRoutePathname } = await import("../src/lib/route-params");
  const seen: string[] = [];
  function Probe() {
    seen.push(useRoutePathname());
    return null;
  }
  navigation.pathname = "/photos/a/REF/";
  await mount(h(Probe));
  navigation.pathname = null;
  await mount(h(Probe));
  expect(seen.at(0)).toBe("/photos/a/REF");
  expect(seen.at(-1)).toBe("/");
});

it("reads a Home item's domain and ref from the native pathname, leaving the placeholder unmatched", async () => {
  const { matchRouteParams } = await import("../src/lib/route-params");
  const pattern = "/home/[domain]/i/[ref]";
  expect(matchRouteParams(pattern, "/home/health/i/aHR0cHM6Ly9wb2Qv/")).toEqual({
    domain: "health",
    ref: "aHR0cHM6Ly9wb2Qv",
  });
  expect(matchRouteParams(pattern, "/home/__/i/__/")).toBeUndefined();
  expect(matchRouteParams(pattern, "/home/health/")).toBeUndefined();
});
