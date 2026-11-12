// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";

const compile = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../src/message.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/message.js")>();
  return {
    ...actual,
    compileMessage: (source: string) => {
      compile.calls.push(source);
      return actual.compileMessage(source);
    },
  };
});
const { createI18n } = await import("../src/translator.js");

it("parses each catalog message once per translator, including English fallbacks", () => {
  const i18n = createI18n({
    english: { hello: "Hi {name}", plain: "Plain", broken: "{" },
    catalogs: { es: { hello: "Hola {name}" } },
    locale: "es",
  });
  for (const name of ["Ada", "Grace", "Ada"]) i18n.t("hello", { name });
  i18n.t("plain");
  i18n.t("plain");
  expect(i18n.t("hello", { name: "Lin" })).toBe("Hola Lin");
  expect(compile.calls).toEqual(["Hola {name}", "Plain"]);
  // Malformed messages are not cached; they fail (and fall back) on every call.
  expect((i18n.t as (key: string) => string)("broken")).toBe("broken");
  expect((i18n.t as (key: string) => string)("broken")).toBe("broken");
  expect(compile.calls.filter((source) => source === "{")).toHaveLength(2);
  // A separate translator keeps its own cache.
  createI18n({ english: { plain: "Plain" } }).t("plain");
  expect(compile.calls.filter((source) => source === "Plain")).toHaveLength(2);
});
