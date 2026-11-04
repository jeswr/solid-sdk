// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataController } from "../src/data-controller.js";
import { AccessDeniedError, DataFormatError, NetworkError, NotFoundError } from "../src/errors.js";
import {
  type AccessRequest,
  canRequestAccess,
  RequestAccessUnavailableError,
  requestAccessAfterDenial,
} from "../src/request-access.js";

const url = "https://pod.example/private";
const denial = new AccessDeniedError(url, { status: 403 });
const request: AccessRequest = Object.freeze({
  classes: Object.freeze(["https://schema.org/Person"]),
  modes: Object.freeze(["read"]),
  purpose: "Display contacts",
  duration: "P30D",
});
const grant = Object.freeze({
  grantId: "fixture-grant",
  dataClass: request.classes[0],
  modes: request.modes,
  purpose: request.purpose,
  expiresAt: 1_800_000_000_000,
  targets: [{ url, kind: "instance" }],
});

function extensionTarget() {
  const solid = {
    requestAccess: vi.fn(async (_request: AccessRequest) => ({ ok: true, grants: [grant] })),
    login: vi.fn(),
    fetch: vi.fn(),
  };
  return { solid };
}

afterEach(() => vi.unstubAllGlobals());

describe("canRequestAccess", () => {
  it.each([
    null,
    undefined,
    false,
    0,
    "solid",
    {},
    { solid: null },
    { solid: {} },
    { solid: { login: vi.fn() } },
    { solid: { requestAccess: true } },
    { solid: { requestAccess: "function" } },
    { solid: { requestAccess: {} } },
  ])("rejects an absent or non-callable capability: %j", (target) => {
    expect(canRequestAccess(target)).toBe(false);
  });

  it("detects a callable capability without invoking it or requiring login", () => {
    const requestAccess = vi.fn();
    expect(canRequestAccess({ solid: { requestAccess } })).toBe(true);
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("uses the injected window.solid by default and detects removal", () => {
    vi.stubGlobal("solid", extensionTarget().solid);
    expect(canRequestAccess()).toBe(true);
    expect(canRequestAccess(window)).toBe(true);
    vi.stubGlobal("solid", undefined);
    expect(canRequestAccess()).toBe(false);
  });
});

describe("requestAccessAfterDenial", () => {
  it.each([
    {},
    { solid: {} },
    { solid: { requestAccess: true } },
    null,
  ])("throws a typed error when the capability is unavailable: %j", async (target) => {
    await expect(requestAccessAfterDenial(denial, request, target)).rejects.toMatchObject({
      name: "RequestAccessUnavailableError",
    });
    await expect(requestAccessAfterDenial(denial, request, target)).rejects.toBeInstanceOf(
      RequestAccessUnavailableError,
    );
  });

  it.each([
    new Error("Forbidden"),
    new NotFoundError(url),
    new NetworkError(url, { status: 403 }),
    new DataFormatError(url),
    { name: "AccessDeniedError", status: 403 },
    { status: 401 },
    null,
    undefined,
  ])("rejects a non-AccessDeniedError before prompting: %j", async (error) => {
    const target = extensionTarget();
    await expect(requestAccessAfterDenial(error, request, target)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(target.solid.requestAccess).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    "request",
    {},
    { classes: request.classes },
    { modes: request.modes },
    { classes: [], modes: request.modes },
    { classes: request.classes, modes: [] },
    { classes: request.classes[0], modes: request.modes },
    { classes: request.classes, modes: "read" },
    { classes: new Array(1), modes: request.modes },
    { classes: request.classes, modes: new Array(1) },
  ])("rejects a missing, empty or malformed scope before prompting: %j", async (invalid) => {
    const target = extensionTarget();
    await expect(
      requestAccessAfterDenial(denial, invalid as AccessRequest, target),
    ).rejects.toBeInstanceOf(TypeError);
    expect(target.solid.requestAccess).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "/Person",
    "//schema.org/Person",
    "urn:example:Person",
    "ftp://schema.org/Person",
    "javascript:alert(1)",
    "http://",
    "https://[invalid]/Person",
    "https:Person",
    "https:///schema.org/Person",
    " https://schema.org/Person",
    "https://schema.org/Person ",
    "https://schema.org/Per\nson",
    "https://schema.org/Per son",
    "https://schema.org/Per\\son",
    "https://schema.org/Per\u0000son",
    "https://schema.org/Per\uD800son",
    "https://schema.org/<Person>",
    "https://schema.org/%ZZ",
    null,
    123,
    { toString: () => "https://schema.org/Person" },
  ])("rejects every invalid class, including in a mixed list: %j", async (invalidClass) => {
    const target = extensionTarget();
    const invalid = { ...request, classes: [...request.classes, invalidClass] };
    await expect(
      requestAccessAfterDenial(denial, invalid as AccessRequest, target),
    ).rejects.toBeInstanceOf(TypeError);
    expect(target.solid.requestAccess).not.toHaveBeenCalled();
  });

  it.each([
    "",
    " ",
    "control",
    "delete",
    "read write",
    "acl:Read",
    "https://www.w3.org/ns/auth/acl#Read",
    "http://www.w3.org/ns/auth/acl#Control",
    "http://www.w3.org/ns/auth/acl#read",
    "https://example.com/Read",
    "http://www.w3.org/ns/auth/acl#ReadExtra",
    null,
    123,
    { toString: () => "read" },
  ])("rejects every unsupported mode, including in a mixed list: %j", async (invalidMode) => {
    const target = extensionTarget();
    const invalid = { ...request, modes: ["read", invalidMode] };
    await expect(
      requestAccessAfterDenial(denial, invalid as AccessRequest, target),
    ).rejects.toBeInstanceOf(TypeError);
    expect(target.solid.requestAccess).not.toHaveBeenCalled();
  });

  it.each([
    "read",
    "append",
    "write",
    "Read",
    " APPEND ",
    "WRITE",
    "http://www.w3.org/ns/auth/acl#Read",
    "http://www.w3.org/ns/auth/acl#Append",
    "http://www.w3.org/ns/auth/acl#Write",
  ])("accepts a supported mode without rewriting it: %s", async (mode) => {
    const target = extensionTarget();
    const input = { ...request, modes: [mode] };
    await expect(requestAccessAfterDenial(denial, input, target)).resolves.toEqual({
      ok: true,
      granted: true,
    });
    expect(target.solid.requestAccess.mock.calls[0]?.[0]).toBe(input);
  });

  it("passes the exact frozen request with all classes and optional fields unchanged", async () => {
    const target = extensionTarget();
    const input = Object.freeze({
      classes: Object.freeze(["http://schema.org/Person", "https://example.com/語彙#人"]),
      modes: Object.freeze(["read", "append", "write"]),
      purpose: "  Display contacts  ",
      duration: "P30D",
    });
    target.solid.requestAccess.mockImplementationOnce(async function (this: unknown, received) {
      expect(this).toBe(target.solid);
      expect(received).toBe(input);
      return { ok: true, grants: [grant] };
    });
    await requestAccessAfterDenial(denial, input, target);
    expect(target.solid.requestAccess).toHaveBeenCalledExactlyOnceWith(input);
    expect(target.solid.login).not.toHaveBeenCalled();
    expect(target.solid.fetch).not.toHaveBeenCalled();
  });

  it("forwards omitted purpose/duration without inventing defaults", async () => {
    const target = extensionTarget();
    const input = { classes: request.classes, modes: request.modes };
    await requestAccessAfterDenial(denial, input, target);
    expect(target.solid.requestAccess.mock.calls[0]?.[0]).toBe(input);
    expect(input).not.toHaveProperty("purpose");
    expect(input).not.toHaveProperty("duration");
  });

  it.each([
    { ok: true, grants: [grant], granted: true },
    { ok: true, grants: [], granted: false },
    { ok: false, grants: [], granted: false },
    { ok: false, grants: [grant], granted: false },
  ])("maps ok=$ok with $grants to granted=$granted", async ({ ok, grants, granted }) => {
    const target = extensionTarget();
    target.solid.requestAccess.mockResolvedValueOnce({ ok, grants });
    await expect(requestAccessAfterDenial(denial, request, target)).resolves.toEqual({
      ok,
      granted,
    });
  });

  it("propagates an extension rejection without login or a fetch fallback", async () => {
    const target = extensionTarget();
    const failure = new Error("Consent unavailable");
    target.solid.requestAccess.mockRejectedValueOnce(failure);
    await expect(requestAccessAfterDenial(denial, request, target)).rejects.toBe(failure);
    expect(target.solid.requestAccess).toHaveBeenCalledTimes(1);
    expect(target.solid.login).not.toHaveBeenCalled();
    expect(target.solid.fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    { ok: "true", grants: [grant] },
    { ok: true },
    { ok: true, grants: null },
    { ok: true, grants: "grant" },
    { ok: true, grants: { length: 1 } },
  ])("never reports approval for a malformed extension reply: %j", async (reply) => {
    const target = { solid: { requestAccess: vi.fn(async () => reply) } };
    const result = await requestAccessAfterDenial(denial, request, target);
    expect(result.granted).toBe(false);
    expect(typeof result.ok).toBe("boolean");
  });

  it.each([
    401, 403,
  ])("accepts a DataController %i denial without retrying the read", async (status) => {
    const target = extensionTarget();
    vi.stubGlobal("solid", target.solid);
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const controller = new DataController({ fetch });
    const error = await controller.read(url).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AccessDeniedError);
    await expect(requestAccessAfterDenial(error, request)).resolves.toEqual({
      ok: true,
      granted: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(target.solid.login).not.toHaveBeenCalled();
    expect(target.solid.fetch).not.toHaveBeenCalled();
  });
});
