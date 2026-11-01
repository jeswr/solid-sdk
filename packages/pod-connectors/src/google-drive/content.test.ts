// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { binaryType, download } from "./content.js";

const URL = "https://www.googleapis.com/drive/v3/files/synthetic?alt=media";
const api = (answer: () => Response) => vi.fn(async () => answer()) as unknown as typeof fetch;

describe("Drive bounded downloads", () => {
  it.each([
    ["image/PNG; charset=utf-8", "image/png"],
    ["text/turtle", "application/octet-stream"],
    ["application/ld+json", "application/octet-stream"],
    ["bad\r\nheader", "application/octet-stream"],
    ["", "application/octet-stream"],
  ])("sanitises %s", (input, expected) => expect(binaryType(input)).toBe(expected));

  it("accepts a response with no body", async () => {
    expect(
      await download(
        api(() => new Response(null)),
        URL,
        4,
        false,
      ),
    ).toEqual({ body: new Uint8Array() });
  });

  it.each(["12", "", "0", "invalid"])("maps rate limits with Retry-After=%s", async (retry) => {
    await expect(
      download(
        api(() => new Response("error", { status: 429, headers: { "retry-after": retry } })),
        URL,
        4,
        false,
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: retry === "12" ? 12 : undefined });
  });
  it("handles a rate limit without a body or Retry-After", async () => {
    await expect(
      download(
        api(() => new Response(null, { status: 429 })),
        URL,
        4,
        false,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it.each([401, 403, 404, 410, 500])("surfaces ordinary HTTP %i failures", async (status) => {
    await expect(
      download(
        api(() => new Response("synthetic error", { status })),
        URL,
        4,
        false,
      ),
    ).rejects.toMatchObject({ status });
  });
  it("handles an error with no body", async () => {
    await expect(
      download(
        api(() => new Response(null, { status: 500 })),
        URL,
        4,
        true,
      ),
    ).rejects.toMatchObject({ status: 500 });
  });
  it.each([
    "not JSON",
    "null",
    "{}",
    '{"error": {}}',
    '{"error":{"errors":"invalid"}}',
    '{"error":{"errors":[null,{}, {"reason":"forbidden"}]}}',
    '{"error":{"errors":[{"reason":"forbidden"},{"reason":"exportSizeLimitExceeded"}]}}',
  ])("only accepts the explicit export-limit reason from %s", async (body) => {
    const call = download(
      api(() => new Response(body, { status: 403 })),
      URL,
      4,
      true,
    );
    if (body.includes("exportSizeLimitExceeded"))
      expect(await call).toEqual({ reason: "exportSizeLimitExceeded" });
    else await expect(call).rejects.toMatchObject({ status: 403 });
  });
  it("caps a maliciously large error response", async () => {
    const cancel = vi.fn();
    await expect(
      download(
        api(
          () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(65537));
                },
                cancel,
              }),
              { status: 403 },
            ),
        ),
        URL,
        4,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("surfaces transport and body-read failures", async () => {
    const fail = vi.fn(async () => {
      throw new Error("transport failed");
    });
    await expect(download(fail, URL, 4, false)).rejects.toThrow("transport failed");
    await expect(
      download(
        api(
          () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("body failed"));
                },
              }),
            ),
        ),
        URL,
        4,
        false,
      ),
    ).rejects.toThrow("body failed");
  });
});
