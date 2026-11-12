// AUTHORED-BY Codex GPT-6.1-Sol
import type { Plugin } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import config, { suiteRedirectBase } from "../vite.config.js";

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
  expect(suiteUrl).toBe(expected);
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

it.each([
  "javascript:alert(1)",
  "http://suite.example",
  "https://user:pass@suite.example",
  "https://suite.example/?next=x",
  "https://suite.example/#x",
  "not a url",
])("refuses an unsafe suite URL %s", (value) => {
  expect(() => suiteRedirectBase(value)).toThrow();
});

it("escapes the suite URL for the HTML link", async () => {
  vi.stubEnv("VITE_SUITE_URL", "https://suite.example/a'b");
  if (typeof config !== "function") throw new Error("Missing Vite configuration");
  const resolved = await config({ command: "build", mode: "test" });
  const plugin = resolved.plugins?.[0] as Plugin;
  const transform = plugin.transformIndexHtml as { handler: (html: string) => string };
  expect(transform.handler('<a href="%VITE_SUITE_URL%/x">')).toBe(
    '<a href="https://suite.example/a&#39;b/x">',
  );
});
