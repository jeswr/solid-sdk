// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  for (const key of [
    "NEXT_PUBLIC_APP_BASE_URL",
    "NEXT_PUBLIC_PUBLIC_SUITE_URL",
    "NEXT_PUBLIC_CLIENT_ID_URL",
    "NEXT_PUBLIC_SUITE_TARGET",
  ])
    vi.stubEnv(key, undefined);
  vi.stubGlobal("window", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("keeps public links and client identity at the public https deployment", async () => {
  const urls = await import("../src/lib/urls");
  expect(urls.PUBLIC_SUITE_URL).toBe("https://solid-suite.vercel.app");
  expect(urls.CLIENT_ID_URL).toBe(
    "https://solid-suite.vercel.app/.well-known/solid-client-id-mobile.jsonld",
  );
  expect(urls.appBaseUrl()).toBe(urls.PUBLIC_SUITE_URL);
});

it("uses baked settings for the web and server renders", async () => {
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_SUITE_URL", "https://public.example/");
  vi.stubEnv("NEXT_PUBLIC_CLIENT_ID_URL", "https://identity.example/id");
  vi.stubEnv("NEXT_PUBLIC_APP_BASE_URL", "https://app.example");
  const urls = await import("../src/lib/urls");
  expect(urls.PUBLIC_SUITE_URL).toBe("https://public.example");
  expect(urls.CLIENT_ID_URL).toBe("https://identity.example/id");
  expect(urls.appBaseUrl()).toBe("https://app.example");
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  expect(urls.appBaseUrl()).toBe("https://app.example");
});

it.each([
  "https:",
  "capacitor:",
])("uses the live %s native origin for in-app links", async (protocol) => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  vi.stubEnv("NEXT_PUBLIC_APP_BASE_URL", "https://localhost");
  vi.stubGlobal("window", { location: { protocol, host: "localhost" } });
  const urls = await import("../src/lib/urls");
  expect(urls.appBaseUrl()).toBe(`${protocol}//localhost`);
  expect(urls.PUBLIC_SUITE_URL).toBe("https://solid-suite.vercel.app");
});
