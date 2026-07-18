// AUTHORED-BY Claude Fable 5
import { describe, expect, it } from "vitest";
import { parseAppSpec, parseArgs } from "../src/args.js";
import { toEnvPrefix, toSlug, toTitleWords } from "../src/names.js";

describe("parseArgs", () => {
  it("parses the full §4.1 flag set (space and = forms)", () => {
    const options = parseArgs([
      "my-demo",
      "--use-case",
      "trails",
      "--convener=Meridian Trails Collective",
      "--negation",
      "Nothing here is an offer of guided travel.",
      "--negation=Nothing here is a permit decision.",
      "--app",
      "vault:Traveller Vault:personal data custodian",
      "--app=permits:Permit Desk:day-permit issuer",
      "--modelled-on",
      "permits=Ridgeway Range Authority",
      "--no-install",
      "--seed",
    ]);
    expect(options.errors).toEqual([]);
    expect(options.targetDir).toBe("my-demo");
    expect(options.useCase).toBe("trails");
    expect(options.convener).toBe("Meridian Trails Collective");
    expect(options.negations).toHaveLength(2);
    expect(options.apps.map((app) => app.slug)).toEqual(["vault", "permits"]);
    expect(options.apps[1]).toEqual({
      name: "Permit Desk",
      role: "day-permit issuer",
      slug: "permits",
    });
    expect(options.modelledOn).toEqual({ permits: "Ridgeway Range Authority" });
    expect(options.install).toBe(false);
    expect(options.seed).toBe(true);
  });

  it("collects every error at once", () => {
    const options = parseArgs([
      "a",
      "b",
      "--bogus",
      "--app",
      "notaspec",
      "--modelled-on",
      "ghost=Somewhere",
    ]);
    expect(options.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects a duplicate app slug and reserved slugs", () => {
    const dup = parseArgs(["--app", "vault:A:role", "--app", "vault:B:role"]);
    expect(dup.errors.some((error) => error.includes("more than once"))).toBe(true);
    const reserved = parseArgs(["--app", "tour:Shell:shell"]);
    expect(reserved.errors.some((error) => error.includes("reserved"))).toBe(true);
  });

  it("rejects a value-less value flag", () => {
    const options = parseArgs(["--use-case"]);
    expect(options.errors).toEqual(["--use-case requires a value"]);
  });
});

describe("parseAppSpec", () => {
  it("keeps colons after the second separator inside the role", () => {
    expect(parseAppSpec("desk:The Desk:role: with colon")).toEqual({
      name: "The Desk",
      role: "role: with colon",
      slug: "desk",
    });
  });

  it("rejects bad slugs", () => {
    expect(typeof parseAppSpec("Bad Slug:Name:role")).toBe("string");
    expect(typeof parseAppSpec("noname")).toBe("string");
  });
});

describe("names", () => {
  it("derives slug, env prefix, and title", () => {
    expect(toSlug("  Car Hire! ")).toBe("car-hire");
    expect(toEnvPrefix("car-hire")).toBe("CAR_HIRE");
    expect(toTitleWords("car-hire")).toBe("Car Hire");
    expect(toSlug("!!!")).toBeUndefined();
  });
});
