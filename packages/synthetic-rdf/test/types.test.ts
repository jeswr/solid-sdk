// AUTHORED-BY GPT-5.6 Sol via codex

import { expectTypeOf, it } from "vitest";
import type { generate, generateUnchecked } from "../src/index.js";

it("keeps validation mandatory only on the checked API", () => {
  expectTypeOf<Parameters<typeof generate>[0]>().toHaveProperty("validator");
  expectTypeOf<Parameters<typeof generateUnchecked>[0]>().not.toHaveProperty("validator");
});
