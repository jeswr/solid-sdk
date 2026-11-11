// AUTHORED-BY Codex (GPT-6.1 Sol)
import { afterEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ create: vi.fn(), construct: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: fake.create };
    constructor(options: unknown) {
      fake.construct(options);
    }
  },
}));

import { maxDuration, POST, runtime } from "../../src/app/api/ask/route";

const request = () =>
  new Request("https://suite.example/api/ask", {
    method: "POST",
    headers: { origin: "https://suite.example", "content-type": "application/json" },
    body: JSON.stringify({
      question: "passport",
      passages: [
        {
          url: "https://pod.example/note",
          title: "Note",
          app: "notes",
          text: "Passport expires in 2028.",
        },
      ],
    }),
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("isolates the SDK in the server route with timeout, no retries, no logs and cancellation", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-test-key");
  fake.create.mockResolvedValue({
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "2028 [1]." },
      { type: "thinking", thinking: "do not expose" },
    ],
  });
  const r = await POST(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ text: "2028 [1]." });
  expect(fake.construct).toHaveBeenCalledWith({
    apiKey: "fake-test-key",
    maxRetries: 0,
    timeout: 45000,
    logLevel: "off",
  });
  expect(fake.create.mock.calls[0]?.[0]).toMatchObject({
    model: "claude-opus-5-5",
    max_tokens: 2000,
  });
  expect(fake.create.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  expect(runtime).toBe("nodejs");
  expect(maxDuration).toBe(60);
});
it("rejects a truncated model answer", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-test-key");
  fake.create.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
  expect((await POST(request())).status).toBe(502);
});
