// AUTHORED-BY Claude Opus 5.5
// An abort that lands after the body is read must reach the RDF parser and surface as `network`.
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { createSolidBackend } from "./solid.js";

const ROOT = "https://pod.example/";
const afterBody = vi.hoisted(() => ({ hook: undefined as (() => void) | undefined }));

vi.mock("./http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http.js")>();
  return {
    ...actual,
    boundedText: async (...args: Parameters<typeof actual.boundedText>) => {
      const text = await actual.boundedText(...args);
      afterBody.hook?.();
      return text;
    },
  };
});

describe("RDF parse cancellation", () => {
  test("an abort between reading and parsing a listing is a non-retryable network error", async () => {
    const controller = new AbortController();
    afterBody.hook = () => controller.abort(new Error("stop"));
    const body = `<> <http://www.w3.org/ns/ldp#contains> <${ROOT}a> .\n`;
    const storage = createSolidBackend({
      root: ROOT,
      fetch: async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
    });
    try {
      const error = await storage
        .list(ROOT, { maxBytes: 1024, signal: controller.signal })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ code: "network", retryable: false });
    } finally {
      afterBody.hook = undefined;
    }
  });
});
