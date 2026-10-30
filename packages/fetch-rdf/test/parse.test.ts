// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { testParseRdf } from "./parse-cases.js";

const { extractMediaType } = api;
testParseRdf("default", api);

describe("extractMediaType", () => {
  it("strips parameters and lowercases", () => {
    expect(extractMediaType("Text/Turtle; charset=UTF-8")).toBe("text/turtle");
  });

  it("returns null for null input", () => {
    expect(extractMediaType(null)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(extractMediaType("not a media type ///")).toBeNull();
  });
});
