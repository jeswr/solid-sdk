// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test } from "vitest";
import {
  MAX_PROBLEM_BYTES,
  parseRetryAfter,
  readErrorBody,
  StorageError,
  type StorageErrorCode,
  storageErrorFrom,
  toStorageError,
} from "./errors.js";

const URL_ = "https://pod.example/a";
const NOW = Date.parse("2026-10-26T12:00:00Z");

function response(status: number, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers) };
}

describe("toStorageError: every HTTP-mapped StorageErrorCode", () => {
  test.each<[number, StorageErrorCode, boolean]>([
    [400, "bad-request", false],
    [401, "unauthenticated", false],
    [403, "forbidden", false],
    [404, "not-found", false],
    [405, "method-not-allowed", false],
    [406, "bad-request", false],
    [409, "conflict", false],
    [410, "not-found", false],
    [412, "precondition-failed", false],
    [413, "payload-too-large", false],
    [415, "unsupported-media-type", false],
    [416, "bad-request", false],
    [422, "bad-request", false],
    [428, "precondition-required", false],
    [429, "rate-limited", true],
    [500, "server", false],
    [501, "server", false],
    [502, "server", true],
    [503, "server", true],
    [504, "server", true],
    [507, "insufficient-storage", false],
    [200, "invalid-response", false],
    [302, "invalid-response", false],
    [0, "invalid-response", false],
  ])("%i → %s (retryable %s)", (status, code, retryable) => {
    const error = toStorageError("PUT", URL_, response(status), undefined, NOW);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({
      name: "StorageError",
      code,
      status,
      url: URL_,
      method: "PUT",
      retryable,
      etag: null,
      problem: null,
    });
    expect(error.message).toContain(code);
  });

  test("the non-HTTP codes are constructible with their defaults", () => {
    const codes: StorageErrorCode[] = [
      "network",
      "not-rdf",
      "unsupported",
      "scope",
      "invalid-response",
    ];
    for (const code of codes) {
      const error = new StorageError(code, { url: URL_, method: "GET" });
      expect(error).toMatchObject({
        code,
        status: null,
        retryable: code === "network",
        retryAfterMs: null,
      });
      expect(error.message).toBe(`GET ${URL_} failed: ${code}`);
    }
    const unsupported = new StorageError("unsupported", {
      url: URL_,
      method: "MOVE",
      feature: "move",
      cause: new Error("x"),
      message: "custom",
    });
    expect(unsupported).toMatchObject({ feature: "move", message: "custom" });
    expect(unsupported.cause).toBeInstanceOf(Error);
    expect(new StorageError("scope", { url: URL_, method: "GET" }).feature).toBeUndefined();
  });

  test("412 carries the current ETag; other statuses do not", () => {
    expect(toStorageError("PUT", URL_, response(412, { ETag: 'W/"7"' })).etag).toBe('W/"7"');
    expect(toStorageError("PUT", URL_, response(409, { ETag: '"7"' })).etag).toBeNull();
  });

  test("Retry-After: seconds and HTTP-date on 429 and 503 only", () => {
    expect(
      toStorageError("GET", URL_, response(429, { "Retry-After": "120" }), undefined, NOW)
        .retryAfterMs,
    ).toBe(120_000);
    expect(
      toStorageError(
        "GET",
        URL_,
        response(503, { "Retry-After": "Mon, 26 Oct 2026 12:00:30 GMT" }),
        undefined,
        NOW,
      ).retryAfterMs,
    ).toBe(30_000);
    expect(
      toStorageError("GET", URL_, response(500, { "Retry-After": "5" })).retryAfterMs,
    ).toBeNull();
    expect(toStorageError("GET", URL_, response(429)).retryAfterMs).toBeNull();
  });
});

describe("parseRetryAfter", () => {
  test.each([
    ["0", 0],
    [" 7 ", 7000],
    ["Mon, 26 Oct 2026 11:59:00 GMT", 0],
    ["soon", null],
    ["-5", null],
    ["99999999999999999999", null],
  ])("%s → %s", (value, expected) => {
    expect(parseRetryAfter(value, NOW)).toBe(expected);
  });
  test("absent → null", () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
  });
});

describe("RFC 9457 problem parsing", () => {
  const problem = {
    type: "https://example.org/probs/out-of-credit",
    title: "You do not have enough credit.",
    detail: "Your current balance is 30, but that costs 50.",
    instance: "/account/12345/msgs/abc",
    balance: 30,
  };

  test("parses application/problem+json, keeping extension members", () => {
    const error = toStorageError(
      "POST",
      URL_,
      response(403, { "Content-Type": "application/problem+json; charset=utf-8" }),
      JSON.stringify(problem),
    );
    expect(error.problem).toEqual(problem);
  });

  test("drops non-string standard members", () => {
    const error = toStorageError(
      "POST",
      URL_,
      response(400, { "Content-Type": "application/problem+json" }),
      JSON.stringify({ title: 5, detail: "d", type: null, instance: ["x"] }),
    );
    expect(error.problem).toEqual({ detail: "d" });
  });

  test("plain JSON counts only when it carries title or detail", () => {
    const json = response(400, { "Content-Type": "application/json" });
    expect(toStorageError("GET", URL_, json, '{"title":"t"}').problem).toEqual({ title: "t" });
    expect(toStorageError("GET", URL_, json, '{"detail":"d"}').problem).toEqual({ detail: "d" });
    expect(toStorageError("GET", URL_, json, '{"error":"x"}').problem).toBeNull();
  });

  test.each([
    ["text/turtle", "<a> <b> <c> ."],
    ["text/html", "<h1>nope</h1>"],
    ["application/problem+json", "not json"],
    ["application/problem+json", "[1,2]"],
    ["application/problem+json", "null"],
    [undefined, '{"title":"x"}'],
  ])("discards %s bodies that are not problem objects", (contentType, body) => {
    const headers: Record<string, string> = contentType ? { "Content-Type": contentType } : {};
    expect(toStorageError("GET", URL_, response(500, headers), body).problem).toBeNull();
  });

  test("ignores bodies over 64 KiB", () => {
    const big = JSON.stringify({ title: "x".repeat(MAX_PROBLEM_BYTES) });
    expect(
      toStorageError(
        "GET",
        URL_,
        response(500, { "Content-Type": "application/problem+json" }),
        big,
      ).problem,
    ).toBeNull();
  });
});

describe("reading error bodies", () => {
  test("storageErrorFrom reads a bounded problem body", async () => {
    const error = await storageErrorFrom(
      "DELETE",
      URL_,
      new Response(JSON.stringify({ title: "Conflict", detail: "not empty" }), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    expect(error).toMatchObject({
      code: "conflict",
      problem: { title: "Conflict", detail: "not empty" },
    });
  });

  test("non-JSON bodies are cancelled unread", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const result = await readErrorBody(
      new Response(body, { status: 500, headers: { "Content-Type": "text/html" } }),
    );
    expect(result).toBeUndefined();
    expect(cancelled).toBe(true);
  });

  test("oversized, bodiless and failing JSON bodies yield undefined", async () => {
    const json = { "Content-Type": "application/json" };
    expect(
      await readErrorBody(
        new Response("x".repeat(MAX_PROBLEM_BYTES + 1), { status: 500, headers: json }),
      ),
    ).toBeUndefined();
    expect(await readErrorBody(new Response(null, { status: 500, headers: json }))).toBeUndefined();
    const failing = new ReadableStream({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    });
    expect(
      await readErrorBody(new Response(failing, { status: 500, headers: json })),
    ).toBeUndefined();
    expect(await readErrorBody(new Response(null, { status: 500 }))).toBeUndefined();
  });

  test("a failing cancel never masks the result", async () => {
    const throwingCancel = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(MAX_PROBLEM_BYTES + 1));
        },
        cancel() {
          throw new Error("cancel failed");
        },
      });
    expect(
      await readErrorBody(
        new Response(throwingCancel(), { status: 500, headers: { "Content-Type": "text/html" } }),
      ),
    ).toBeUndefined();
    expect(
      await readErrorBody(
        new Response(throwingCancel(), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).toBeUndefined();
  });

  test("multi-chunk bodies are reassembled", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"title":'));
        controller.enqueue(encoder.encode('"split"}'));
        controller.close();
      },
    });
    expect(
      await readErrorBody(
        new Response(body, {
          status: 400,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    ).toBe('{"title":"split"}');
  });
});
