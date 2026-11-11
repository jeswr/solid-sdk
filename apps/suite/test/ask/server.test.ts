// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it, vi } from "vitest";
import { ASK_MODEL, ASK_REQUEST_BYTES, createAskHandler } from "../../src/apps/ask/server";
import { createLimiter } from "../../src/feedback/security";

const payload = {
  question: "passport",
  passages: [
    {
      url: "https://pod.example/passport",
      title: "Passport",
      app: "notes",
      text: "Passport expires in 2028.",
    },
  ],
};
function request(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request("https://suite.example/api/ask", {
    method: "POST",
    headers: { origin: "https://suite.example", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function setup(key = "synthetic-test-key") {
  const complete = vi.fn(async () => "In 2028 [1].");
  return {
    complete,
    handler: createAskHandler({
      env: { ANTHROPIC_API_KEY: key },
      complete,
      limit: createLimiter(() => 1000),
    }),
  };
}
describe("hosted grounded completion boundary", () => {
  it("uses one shared model constant and no-store responses, with only validated data", async () => {
    const { handler, complete } = setup();
    const r = await handler(request());
    expect(ASK_MODEL).toBe("claude-opus-5-5");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "In 2028 [1]." });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.length).toBe(2);
  });
  it("never calls a model without a configured key or from an unapproved origin", async () => {
    const { handler, complete } = setup(" ");
    expect((await handler(request())).status).toBe(503);
    expect((await handler(request(payload, { origin: "https://evil.example" }))).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });
  it("inherits feedback's visitor and instance limits with Retry-After", async () => {
    const complete = vi.fn(async () => "Answer [1].");
    const handler = createAskHandler({
      env: { ANTHROPIC_API_KEY: "fake" },
      complete,
      limit: createLimiter(() => 1000, { turn: 1, submit: 0 }),
    });
    expect((await handler(request())).status).toBe(200);
    const limited = await handler(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.has("retry-after")).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("rejects non-JSON, missing bodies, malformed JSON and unknown fields", async () => {
    const { handler, complete } = setup();
    expect((await handler(request(payload, { "content-type": "text/plain" }))).status).toBe(415);
    expect(
      (
        await handler(
          new Request("https://suite.example/api/ask", {
            method: "POST",
            headers: { origin: "https://suite.example", "content-type": "application/json" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("https://suite.example/api/ask", {
            method: "POST",
            headers: { origin: "https://suite.example", "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handler(request({ ...payload, tokens: "never accept credentials" }))).status,
    ).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, question: " " },
    { ...payload, question: "x".repeat(2001) },
    { ...payload, passages: [] },
    { ...payload, passages: Array(9).fill(payload.passages[0]) },
    { ...payload, passages: [{ ...payload.passages[0], url: "javascript:alert(1)" }] },
    { ...payload, passages: [{ ...payload.passages[0], text: "x".repeat(4001) }] },
    { ...payload, passages: [{ ...payload.passages[0], fetchUrl: "https://evil.example" }] },
  ])("validates incoming evidence: %s", async (body) => {
    const { handler, complete } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it("caps actual UTF-8 request bytes, not just Content-Length", async () => {
    const { handler } = setup();
    expect(
      (await handler(request({ ...payload, question: "x".repeat(ASK_REQUEST_BYTES) }))).status,
    ).toBe(413);
    expect(
      (await handler(request(payload, { "content-length": String(ASK_REQUEST_BYTES + 1) }))).status,
    ).toBe(413);
  });
  it("rejects total prompt overflow rather than renumbering or silently truncating sources", async () => {
    const { handler, complete } = setup();
    const r = await handler(
      request({
        question: "passport",
        passages: Array.from({ length: 8 }, () => ({
          ...payload.passages[0],
          text: "x".repeat(4000),
        })),
      }),
    );
    expect(r.status).toBe(413);
    expect(complete).not.toHaveBeenCalled();
    expect(
      (
        await handler(
          request({
            question: "passport",
            passages: [
              { ...payload.passages[0], text: "\n".repeat(4000) },
              ...Array.from({ length: 7 }, () => ({
                ...payload.passages[0],
                text: "x".repeat(3500),
              })),
            ],
          }),
        )
      ).status,
    ).toBe(413);
  });
  it.each([
    new Error("PRIVATE_CONTENT_AND_KEY"),
    { status: 429, message: "PRIVATE" },
    null,
  ])("sanitises provider errors: %s", async (error) => {
    const { complete, handler } = setup();
    complete.mockRejectedValue(error);
    const r = await handler(request());
    expect(r.status).toBe(error && "status" in error ? 429 : 502);
    expect(await r.text()).not.toContain("PRIVATE");
  });
  it.each(["", " ", "x".repeat(16001)])("rejects incomplete or excessive answers", async (text) => {
    const { handler, complete } = setup();
    complete.mockResolvedValue(text);
    expect((await handler(request())).status).toBe(502);
  });
  it("bounds the default shared limiter as well", async () => {
    const handler = createAskHandler({ env: {}, complete: async () => "unused" });
    expect((await handler(request())).status).toBe(503);
  });
});
