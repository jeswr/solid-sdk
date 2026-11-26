// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { createI18n, type PartialCatalog } from "../src/index.js";

const english = {
  plain: "Plain",
  nested: { hello: "Hello {name}" },
  count: "{n, plural, one {{name}: #} other {#}}",
  select: "{role, select, editor {{name}} other {Read}}",
  escaped: "\\{literal\\}",
  mixed: "{n} {n, plural, other {#}}",
} as const;
const t = createI18n({ english }).t;
// tsc checks this function's negative cases; execution is unnecessary.
function typeContract() {
  t("plain");
  t("nested.hello", { name: "Ada" });
  t("count", { n: 2, name: "Ada" });
  t("select", { role: "editor", name: "Ada" });
  t("escaped");
  t("mixed", { n: 1 });
  // @ts-expect-error no unknown keys
  t("missing");
  // @ts-expect-error nested objects are not messages
  t("nested");
  // @ts-expect-error interpolation requires params
  t("nested.hello");
  // @ts-expect-error misspelled parameter
  t("nested.hello", { person: "Ada" });
  // @ts-expect-error no extra parameters
  t("plain", { extra: "x" });
  // @ts-expect-error numeric plural count
  t("count", { n: "2", name: "Ada" });
  // @ts-expect-error nested branches contribute parameters
  t("count", { n: 2 });
  // @ts-expect-error select requires string
  t("select", { role: 1, name: "Ada" });
  // @ts-expect-error repeated interpolation retains plural type
  t("mixed", { n: "2" });
  const partial: PartialCatalog<typeof english> = { nested: {} };
  // @ts-expect-error locale cannot add keys
  const extra: PartialCatalog<typeof english> = { absent: "x" };
  return [partial, extra];
}
it("publishes the typed translator", () => {
  expect(typeContract).toBeTypeOf("function");
  expect(t("nested.hello", { name: "Ada" })).toBe("Hello Ada");
});
