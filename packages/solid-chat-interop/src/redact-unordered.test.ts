// AUTHORED-BY Claude Sonnet 5.5
// Fields whose stored order is unknown: redacted as if under any ordering of each run.
import { describe, expect, it } from "vitest";
import { hasUnprovenTies, redactSecretFields } from "./redact.js";

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

  it("never blanket-redacts a run too large for pair checks: members alone, PEM and stored neighbours", () => {
    const run = Array.from({ length: 65 }, (_, i) => `note ${i}`);
    const fields = ["T", "before", ...run];
    const groups = [-1, 0, ...run.map(() => 1)];
    expect(hasUnprovenTies(groups)).toBe(true);
    expect(redactSecretFields(fields, groups)).toEqual(fields);
  });

  it("covers a PEM block split over three members of an oversized run, and no other member", () => {
    const run = Array.from({ length: 70 }, (_, i) => `note ${i}`);
    run[10] = `x\n${BEGIN}`;
    run[40] = "BODYBODYBODY";
    run[60] = END;
    const result = redactSecretFields(["T", ...run], [-1, ...run.map(() => 0)]);
    const changed = result.flatMap((text, at) => (text === ["T", ...run][at] ? [] : [at - 1]));
    // Followed in stored order: the delimiters and everything between them, nothing else.
    expect(changed).toEqual(Array.from({ length: 51 }, (_, i) => i + 10));
    expect(result.join("|")).not.toContain("BODYBODYBODY");
    expect(result[11]).toBe("x\n[REDACTED PRIVATE KEY]");
    expect(result[61]).toBe("[REDACTED PRIVATE KEY]\nafter");
    expect(result[1]).toBe("note 0");
    expect(result[70]).toBe("note 69");
  });

  it("checks each member of an oversized run against its stored neighbours, and the previous run", () => {
    const run = Array.from({ length: 70 }, (_, i) => `note ${i}`);
    run[0] = 'fixtureTail"; y';
    run[30] = 'config password="sk-fixtureLeft';
    run[31] = 'fixtureRight"; y = 2';
    const result = redactSecretFields(
      ["T", 'config password="sk-fixtureHead', ...run],
      [-1, 0, ...run.map(() => 1)],
    );
    expect(result.join("|")).not.toContain("fixtureLeft");
    expect(result.join("|")).not.toContain("fixtureRight");
    expect(result.join("|")).not.toContain("fixtureHead");
    expect(result[2]).not.toContain("fixtureTail");
    expect(result[30]).toBe("note 28");
  });

  it("recognises a header split over stored neighbours of an oversized run", () => {
    const run = Array.from({ length: 70 }, (_, i) => `note ${i}`);
    run[5] = "see -----BEGIN PRIV";
    run[6] = "ATE KEY-----\nBODY";
    const result = redactSecretFields(["T", ...run], [-1, ...run.map(() => 0)]).join("|");
    expect(result).not.toContain("BODY");
  });

  it("recognises a header split over the join with the previous run of an oversized run", () => {
    const run = Array.from({ length: 70 }, (_, i) => `note ${i}`);
    run[0] = "ATE KEY-----\nBODY";
    const result = redactSecretFields(
      ["T", "see -----BEGIN PRIV", ...run],
      [-1, 0, ...run.map(() => 1)],
    ).join("|");
    expect(result).not.toContain("BODY");
  });

  it("flags two neighbouring runs with too many pairs between them", () => {
    const left = Array.from({ length: 60 }, (_, i) => `left ${i}`);
    const right = Array.from({ length: 60 }, (_, i) => `right ${i}`);
    const fields = ["T", ...left, ...right, "after"];
    const groups = [-1, ...left.map(() => 0), ...right.map(() => 1), 2];
    expect(hasUnprovenTies(groups)).toBe(true);
    expect(redactSecretFields(fields, groups)).toEqual(fields);
  });

  it("does not flag runs within the budget", () => {
    expect(hasUnprovenTies([-1, 0, 0, 1, 2, 2])).toBe(false);
    expect(hasUnprovenTies([])).toBe(false);
  });
});
