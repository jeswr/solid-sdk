// AUTHORED-BY Codex GPT-6
import { useEffect, useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  params: { ref: "web-value" } as Record<string, string | string[]>,
  pathname: "/drive/f/a/" as string | null,
  listeners: new Set<() => void>(),
}));
vi.mock("next/navigation", () => ({
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
async function loadTarget(target: string) {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", target);
  vi.resetModules();
  ({ useRouteParams } = await import("../src/lib/route-params"));
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
