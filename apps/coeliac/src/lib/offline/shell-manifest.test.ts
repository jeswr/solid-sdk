// AUTHORED-BY Claude Fable 5
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAppShellConfig, shellCacheName } from "solid-offline";
import { describe, expect, it } from "vitest";
import {
  APP_SHELL_ROUTES,
  appShellManifest,
  SHELL_CACHE_NAME,
  SHELL_CACHE_PREFIX,
  SHELL_CACHE_VERSION,
  SHELL_FALLBACK_ROUTE,
} from "./shell-manifest";

const SW_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

describe("app-shell manifest", () => {
  it("precaches the primary-nav routes", () => {
    expect([...APP_SHELL_ROUTES]).toEqual([
      "/",
      "/log",
      "/symptoms",
      "/insights",
      "/plan",
      "/protocols",
      "/genetics",
      "/knowledge/research",
      "/community",
    ]);
  });

  it("freezes the route list so it cannot be mutated at runtime", () => {
    expect(Object.isFrozen(APP_SHELL_ROUTES)).toBe(true);
    expect(() => {
      // @ts-expect-error — mutating a readonly frozen array must throw in strict mode
      APP_SHELL_ROUTES.push("/evil");
    }).toThrow();
  });

  it("derives the versioned cache name from the prefix + version", () => {
    expect(SHELL_CACHE_NAME).toBe(`${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}`);
    expect(SHELL_CACHE_NAME).toBe("coeliac-shell-v1");
  });

  it("uses a fallback route that is itself precached", () => {
    expect(APP_SHELL_ROUTES).toContain(SHELL_FALLBACK_ROUTE);
  });

  it("produces a config @jeswr/solid-offline accepts (contract-compatible)", () => {
    const resolved = resolveAppShellConfig(appShellManifest());
    // No duplicates, fallback preserved, version carried — the library's shape.
    expect(resolved.precache).toEqual([...APP_SHELL_ROUTES]);
    expect(resolved.fallback).toBe(SHELL_FALLBACK_ROUTE);
    expect(resolved.version).toBe(SHELL_CACHE_VERSION);
    // The library's own cache-name helper is version-scoped just like ours.
    expect(shellCacheName(SHELL_CACHE_VERSION)).toContain(SHELL_CACHE_VERSION);
  });
});

describe("service-worker / manifest drift guard", () => {
  it("public/sw.js pins the same cache version + name as the manifest", () => {
    expect(SW_SOURCE).toContain(`const SHELL_CACHE_VERSION = "${SHELL_CACHE_VERSION}";`);
    expect(SW_SOURCE).toContain(`const SHELL_CACHE_PREFIX = "${SHELL_CACHE_PREFIX}";`);
    expect(SW_SOURCE).toContain(`const SHELL_FALLBACK_ROUTE = "${SHELL_FALLBACK_ROUTE}";`);
  });

  it("public/sw.js precaches exactly the manifest routes", () => {
    // Extract the APP_SHELL_ROUTES array literal from the worker source.
    const match = SW_SOURCE.match(/const APP_SHELL_ROUTES = \[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const routesInSw = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(routesInSw).toEqual([...APP_SHELL_ROUTES]);
  });
});
