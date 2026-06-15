// AUTHORED-BY Claude Opus 4.8
/**
 * Argument parsing for the create-solid-app CLI. Pins that known flags parse, that an UNKNOWN flag
 * or a SECOND positional (extra app name) is rejected with a usage error rather than silently
 * ignored, and that `--help` wins even alongside an error.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../bin.ts";

describe("parseArgs", () => {
  it("parses an app name with default flags", () => {
    const a = parseArgs(["my-app"]);
    expect(a.appName).toBe("my-app");
    expect(a.install).toBe(true);
    expect(a.seedPod).toBe(false);
    expect(a.error).toBeUndefined();
  });

  it("honours --no-install and --seed-pod", () => {
    const a = parseArgs(["my-app", "--no-install", "--seed-pod"]);
    expect(a.install).toBe(false);
    expect(a.seedPod).toBe(true);
    expect(a.error).toBeUndefined();
  });

  it("rejects an unknown flag", () => {
    const a = parseArgs(["my-app", "--frobnicate"]);
    expect(a.error).toMatch(/unknown flag: --frobnicate/);
  });

  it("rejects a second app-name positional", () => {
    const a = parseArgs(["app-one", "app-two"]);
    expect(a.error).toMatch(/extra argument: app-two/);
  });

  it("reports help even when an error is present", () => {
    const a = parseArgs(["--help", "--bogus"]);
    expect(a.help).toBe(true);
  });
});
