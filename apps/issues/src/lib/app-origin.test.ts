// AUTHORED-BY Claude Opus 4.8
// vitest — pure origin-normalisation logic for the client-id document build.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_APP_ORIGIN, buildOrigin, normaliseOrigin } from "./app-origin";

describe("normaliseOrigin", () => {
  it("strips a trailing slash / path to a bare origin", () => {
    expect(normaliseOrigin("https://issues.solid-test.jeswr.org/")).toBe(
      "https://issues.solid-test.jeswr.org",
    );
    expect(normaliseOrigin("https://issues.solid-test.jeswr.org/anything/here")).toBe(
      "https://issues.solid-test.jeswr.org",
    );
  });

  it("keeps an explicit port", () => {
    expect(normaliseOrigin("http://localhost:3200")).toBe("http://localhost:3200");
  });

  it("rejects a non-absolute value", () => {
    expect(() => normaliseOrigin("issues.solid-test.jeswr.org")).toThrow();
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => normaliseOrigin("ftp://issues.solid-test.jeswr.org")).toThrow(
      /must be an http\(s\) origin/,
    );
  });
});

describe("buildOrigin", () => {
  const original = process.env.APP_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = original;
  });

  it("falls back to the dev default when APP_ORIGIN is unset", () => {
    delete process.env.APP_ORIGIN;
    expect(buildOrigin()).toBe(DEFAULT_APP_ORIGIN);
  });

  it("uses and normalises APP_ORIGIN when set", () => {
    process.env.APP_ORIGIN = "https://issues.solid-test.jeswr.org/";
    expect(buildOrigin()).toBe("https://issues.solid-test.jeswr.org");
  });
});
