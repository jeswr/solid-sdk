// AUTHORED-BY Claude Opus 5.5
import { IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import { UnknownAccountError } from "@jeswr/pod-auth/accounts";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyError, type ErrorCategory } from "./errors.js";

const storage = (code: StorageErrorCode) =>
  new StorageError(code, { url: "https://alice.pod/x", method: "GET" });

/** One row per StorageErrorCode; the Record type makes a missing code a type error. */
const expected: Record<StorageErrorCode, ErrorCategory> = {
  unauthenticated: "reauth",
  forbidden: "forbidden",
  "not-found": "not-found",
  conflict: "name-taken",
  "precondition-failed": "conflict",
  "precondition-required": "unknown",
  "unsupported-media-type": "unsupported",
  "method-not-allowed": "unsupported",
  "payload-too-large": "too-large",
  "insufficient-storage": "quota",
  "rate-limited": "unreachable",
  "bad-request": "unknown",
  server: "unreachable",
  network: "unreachable",
  "invalid-response": "unknown",
  "not-rdf": "unknown",
  unsupported: "unsupported",
  scope: "unknown",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyError", () => {
  it.each(Object.entries(expected))("maps StorageError %s to %s", (code, category) => {
    expect(classifyError(storage(code as StorageErrorCode), true)).toBe(category);
  });

  it("maps a network failure while offline to offline", () => {
    expect(classifyError(storage("network"), false)).toBe("offline");
    expect(classifyError(storage("server"), false)).toBe("unreachable");
  });

  it("defaults connectivity to navigator.onLine", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(classifyError(storage("network"))).toBe("offline");
    vi.stubGlobal("navigator", { onLine: true });
    expect(classifyError(storage("network"))).toBe("unreachable");
    vi.stubGlobal("navigator", undefined);
    expect(classifyError(storage("network"))).toBe("unreachable");
  });

  it.each([
    [new CapabilitiesError("network", "https://alice.pod/"), true, "unreachable"],
    [new CapabilitiesError("network", "https://alice.pod/"), false, "offline"],
    [new CapabilitiesError("description-unreachable", "https://alice.pod/"), true, "unreachable"],
    [new CapabilitiesError("description-unreachable", "u", "m", 401), true, "reauth"],
    [new CapabilitiesError("description-unreachable", "u", "m", 403), true, "forbidden"],
    [new CapabilitiesError("description-unreachable", "u", "m", 404), true, "unreachable"],
    [new CapabilitiesError("description-unreachable", "u", "m", 503), true, "unreachable"],
    [new CapabilitiesError("no-storage-link", "https://alice.pod/"), true, "unknown"],
    [new CapabilitiesError("description-invalid", "https://alice.pod/"), true, "unknown"],
    [new CapabilitiesError("root-mismatch", "https://alice.pod/"), true, "unknown"],
  ] as const)("maps CapabilitiesError %# to its category", (error, online, category) => {
    expect(classifyError(error, online)).toBe(category);
  });

  it("asks for sign-in on pod-auth identity errors", () => {
    expect(classifyError(new IssuerNotAuthorizedError("https://a/#me", "https://idp/"))).toBe(
      "reauth",
    );
    expect(classifyError(new UnknownAccountError("https://a/#me"))).toBe("reauth");
  });

  it("classifies structural errors by storage code, then by HTTP status", () => {
    expect(classifyError({ code: "precondition-failed" }, true)).toBe("conflict");
    expect(classifyError({ code: "not-a-code", status: 404 }, true)).toBe("not-found");
    expect(classifyError({ status: 409 }, true)).toBe("name-taken");
    expect(classifyError({ status: 507 }, true)).toBe("quota");
    expect(classifyError({ status: 0 }, false)).toBe("offline");
    expect(classifyError({ status: 0 }, true)).toBe("unreachable");
    expect(classifyError({ status: 502 }, true)).toBe("unreachable");
    expect(classifyError({ status: 418 }, true)).toBe("unknown");
    expect(classifyError({ code: "toString" }, true)).toBe("unknown");
  });

  it.each([
    null,
    undefined,
    "boom",
    42,
    new Error("plain"),
    new TypeError("Failed to fetch"),
  ])("treats %s as unknown", (value) => {
    expect(classifyError(value, true)).toBe("unknown");
  });
});
