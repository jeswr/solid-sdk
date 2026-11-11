// AUTHORED-BY Codex GPT-6.1-Sol
import type { Plugin } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import config from "../vite.config.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  [undefined, "https://solid-suite.vercel.app"],
  ["https://suite.example/", "https://suite.example"],
])("links and replaces history using the configured suite URL %s", async (configured, expected) => {
  if (configured) vi.stubEnv("VITE_SUITE_URL", configured);
  else vi.stubEnv("VITE_SUITE_URL", undefined);
  if (typeof config !== "function") throw new Error("Missing Vite configuration");
  const resolved = await config({ command: "build", mode: "test" });
  const suiteUrl = JSON.parse(resolved.define?.["import.meta.env.VITE_SUITE_URL"] as string);
  expect(suiteUrl).toBe(configured ?? "https://solid-suite.vercel.app");
  vi.stubEnv("VITE_SUITE_URL", suiteUrl);
  const link = { href: "" };
  const replace = vi.fn();
  vi.stubGlobal("document", { querySelector: () => link });
  vi.stubGlobal("location", { replace });
  await import("../src/main.js");
  expect(link.href).toBe(`${expected}/settings/move-pod`);
  expect(replace).toHaveBeenCalledWith(link.href);
  const plugin = resolved.plugins?.[0] as Plugin;
  if (!plugin || !("transformIndexHtml" in plugin)) throw new Error("Missing HTML fallback");
  const transform = plugin.transformIndexHtml;
  if (!transform || typeof transform !== "object" || typeof transform.handler !== "function")
    throw new Error("Missing HTML transform");
  expect(
    transform.handler.call(
      {} as never,
      '<a href="%VITE_SUITE_URL%/settings/move-pod">Solid Suite Settings</a>',
      {} as never,
    ),
  ).toContain(`href="${link.href}"`);
});
