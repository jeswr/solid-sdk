// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import * as root from "./index.js";
import * as react from "./react.js";
import * as search from "./search/index.js";

describe("@jeswr/suite-sdk/react", () => {
  it("re-exports the root, the subpaths and the façade helpers from one entry point", () => {
    for (const name of Object.keys(root)) expect(react).toHaveProperty(name);
    for (const name of Object.keys(search)) expect(react).toHaveProperty(name);
    for (const name of [
      "classifyError",
      "deriveSuiteCaps",
      "encodeRef",
      "decodeRef",
      "encodeIdentifierRef",
      "decodeIdentifierRef",
      "RefError",
      "useOutbox",
      "createPreferences",
    ]) {
      expect(typeof (react as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
