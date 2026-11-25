// AUTHORED-BY Claude Sonnet 5.5
// Fields whose stored order is unknown: redacted as if under any ordering of each run.
import { describe, expect, it } from "vitest";
import { redactSecretFields } from "./redact.js";

const KEY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";
const BEGIN = `-----BEGIN PRIVATE KEY-----\n${KEY}`;
const END = "-----END PRIVATE KEY-----\nafter";

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe("redactSecretFields with interchangeable runs", () => {
  it("refuses a label list of the wrong length", () => {
    expect(() => redactSecretFields(["a", "b"], [0])).toThrow("Invalid field groups");
  });

  it("is the ordinary redaction when no two fields are interchangeable", () => {
    const fields = ["Title", `x\n${BEGIN}`, "body", END, 'password="sk-abcdefgh', 'ijklmnop"'];
    expect(redactSecretFields(fields, [-1, 0, 1, 2, 3, 4])).toEqual(redactSecretFields(fields));
  });

  it.each(
    permutations(['password="sk-fixtureLeft', 'fixtureRight"; y = 2']),
  )("redacts a secret split over two tied fields in order %j", (...fields) => {
    const result = redactSecretFields(["T", ...fields], [-1, 0, 0]).join("|");
    expect(result).not.toContain("fixtureLeft");
    expect(result).not.toContain("fixtureRight");
  });

  it.each(
    permutations([`x\n${BEGIN}`, "BODYBODYBODY", END]),
  )("redacts a private key over three tied fields in order %#", (...fields) => {
    const result = redactSecretFields(["T", ...fields], [-1, 0, 0, 0]).join("|");
    expect(result).not.toContain("BODYBODYBODY");
    expect(result).not.toContain(KEY.slice(0, 20));
  });

  it("keeps the text after an END and the text before a lone BEGIN", () => {
    const result = redactSecretFields(["T", `x\n${BEGIN}`, "BODY", END], [-1, 0, 0, 0]);
    expect(result[1]).toBe("x\n[REDACTED PRIVATE KEY]");
    expect(result[2]).toBe("[REDACTED]");
    expect(result[3]).toBe("[REDACTED PRIVATE KEY]\nafter");
  });

  it("covers every member of a run when two members each open a block", () => {
    const result = redactSecretFields(["T", BEGIN, `pre ${BEGIN}`], [-1, 0, 0]);
    expect(result[1]).toBe("[REDACTED PRIVATE KEY]");
    expect(result[2]).toBe("[REDACTED PRIVATE KEY]");
  });

  it("carries an open block through a later run until a run that holds an END", () => {
    const result = redactSecretFields(
      ["T", BEGIN, "one", "two", "three", END, "free"],
      [-1, 0, 1, 1, 2, 2, 3],
    );
    expect(result[2]).toBe("[REDACTED]");
    expect(result[3]).toBe("[REDACTED]");
    expect(result[4]).toBe("[REDACTED]");
    expect(result[5]).toBe("[REDACTED PRIVATE KEY]\nafter");
    expect(result[6]).toBe("free");
  });

  it("keeps a block open across a run that holds no END", () => {
    const result = redactSecretFields(["T", BEGIN, "a", "b", "c", "d"], [-1, 0, 1, 1, 2, 2]);
    expect(result.slice(2)).toEqual(["[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]"]);
  });

  it("recognises a header split over the join between two runs", () => {
    const result = redactSecretFields(
      ["T", "see -----BEGIN PRIV", "ATE KEY-----\nBODY", "other", "BODY2"],
      [-1, 0, 1, 1, 1],
    );
    expect(result.join("|")).not.toContain("BODY");
    expect(result[1]).toContain("see");
  });

  it("recognises a header split over the join between two tied fields", () => {
    for (const fields of permutations(["see -----BEGIN PRIV", "ATE KEY-----\nBODY"])) {
      const result = redactSecretFields(["T", ...fields, "later"], [-1, 0, 0, 1]);
      expect(result.join("|")).not.toContain("BODY");
      expect(result.join("|")).not.toContain("later");
    }
  });

  it("covers a run, and its neighbour, whole when the run is too large to examine pair by pair", () => {
    const run = Array.from({ length: 65 }, (_, i) => `note ${i}`);
    const result = redactSecretFields(["T", "before", ...run], [-1, 0, ...run.map(() => 1)]);
    expect(result[1]).toBe("[REDACTED]");
    expect(result.slice(2).every((text) => text === "[REDACTED]")).toBe(true);
  });

  it("does the same when two neighbouring runs have too many pairs between them", () => {
    const left = Array.from({ length: 60 }, (_, i) => `left ${i}`);
    const right = Array.from({ length: 60 }, (_, i) => `right ${i}`);
    const result = redactSecretFields(
      ["T", ...left, ...right, "after"],
      [-1, ...left.map(() => 0), ...right.map(() => 1), 2],
    );
    expect(result.slice(1, -1).every((text) => text === "[REDACTED]")).toBe(true);
    expect(result.at(-1)).toBe("after");
  });
});
