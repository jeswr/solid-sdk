import { describe, expect, it, vi } from "vitest";
import { ClassifierError } from "./classifier.js";
import { TYPESAFE_ENDPOINT, TypeSafeClassifier, typeSafeFromEnv } from "./typesafe.js";

// No network: every test injects a fake fetch. The key below is a test string.
const KEY = "ts-TEST-secret-key-0123456789";
const sample = { subject: "Invoice 12", body: "Please pay the attached invoice within 14 days." };

const PRIMARY = {
  needs_reply: 0.03,
  action: 0.9,
  waiting: 0.02,
  read_later: 0.01,
  fyi: 0.02,
  noise: 0.01,
  uncertain: 0.01,
};
function body(over: Record<string, unknown> = {}) {
  return {
    model: "jev-1.13.0",
    answers: {
      primary: { type: "choice", choice: "action", probabilities: PRIMARY, confidence: 0.85 },
      urgency: {
        type: "choice",
        choice: "not_urgent",
        probabilities: { urgent: 0.1, not_urgent: 0.9 },
        confidence: 0.8,
      },
      needs_reply: { type: "noul", noul: 0.1 },
    },
    usage: { input_tokens: 120, output_tokens: 6 },
    ...over,
  };
}
function reply(value: unknown, init: ResponseInit = {}) {
  return vi.fn(
    async () =>
      new Response(typeof value === "string" ? value : JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
        ...init,
      }),
  );
}
const classifier = (f: ReturnType<typeof vi.fn>) =>
  new TypeSafeClassifier(KEY, "jev-1.13.0", f as unknown as typeof fetch);

async function failure(f: ReturnType<typeof vi.fn>): Promise<ClassifierError> {
  try {
    await classifier(f).classify(sample);
  } catch (error) {
    expect(error).toBeInstanceOf(ClassifierError);
    expect(`${(error as Error).message} ${(error as Error).stack}`).not.toContain(KEY);
    return error as ClassifierError;
  }
  throw new Error("expected a failure");
}

describe("TypeSafe adapter: request", () => {
  it("posts to the fixed official endpoint with the pinned model, bearer key and no redirects", async () => {
    const f = reply(body());
    const a = await classifier(f).classify(sample);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TYPESAFE_ENDPOINT);
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("jev-1.13.0");
    expect(sent.state).toEqual(sample);
    expect(Object.keys(sent.questions)).toEqual(["primary", "urgency", "needs_reply"]);
    expect(Object.keys(sent.questions.primary.criteria)).toContain("uncertain");
    expect(sent.questions.primary.instructions).toMatch(/untrusted/);
    expect(a).toMatchObject({
      primary: { label: "action", probability: 0.9, confidence: 0.85 },
      urgency: { label: "not_urgent", probability: 0.9, confidence: 0.8 },
      needsReply: 0.1,
      model: "jev-1.13.0",
    });
    expect(a.primary.probabilities).toEqual(PRIMARY);
  });

  it("refuses unpinned models and malformed keys at construction", () => {
    for (const model of ["jev-latest", "jev-preview", "gpt-4", "jev-1.13", "https://evil.example"])
      expect(() => new TypeSafeClassifier(KEY, model)).toThrow(/pinned/);
    expect(() => new TypeSafeClassifier("short")).toThrow(/not a valid key/);
    expect(() => new TypeSafeClassifier("has space in it")).toThrow();
  });

  it("never serialises the key", () => {
    const c = classifier(reply(body()));
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(JSON.stringify({ c })).toBe('{"c":{"provider":"TypeSafe","model":"jev-1.13.0"}}');
    expect(Object.keys(c)).not.toContain("apiKey");
  });

  it("is configured from the server environment only", () => {
    expect(typeSafeFromEnv({}).configured).toBe(false);
    const ok = typeSafeFromEnv({ TYPESAFE_API_KEY: KEY }, reply(body()) as unknown as typeof fetch);
    expect(ok.configured).toBe(true);
    expect(ok.model).toBe("jev-1.13.0");
    const alias = typeSafeFromEnv({ TYPESAFE_API_KEY: KEY, TYPESAFE_MODEL: "jev-latest" });
    expect(alias.configured).toBe(false);
    expect(alias.problem).toMatch(/pinned/);
    expect(JSON.stringify(alias)).not.toContain(KEY);
  });
});

describe("TypeSafe adapter: every response is untrusted", () => {
  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [422, "unavailable"],
    [429, "rate-limited"],
    [529, "unavailable"],
    [500, "unavailable"],
  ])("HTTP %i is a %s error", async (status, code) => {
    const e = await failure(reply({ error: `bad key ${KEY}` }, { status }));
    expect(e.code).toBe(code);
    expect(e.message).not.toContain("bad key");
  });

  it("a network failure, a timeout and a broken body stream are sanitised provider errors", async () => {
    const network = await failure(
      vi.fn(async () => Promise.reject(new TypeError(`connect failed ${KEY}`))),
    );
    expect(network.code).toBe("network");
    const timeout = await failure(
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "TimeoutError";
        throw e;
      }),
    );
    expect(timeout.code).toBe("timeout");
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error(`stream reset ${KEY}`));
      },
    });
    const stream = await failure(
      vi.fn(
        async () =>
          new Response(broken, { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    expect(stream.code).toBe("network");
  });

  it("really times out a slow provider", async () => {
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = new TypeSafeClassifier(KEY, "jev-1.13.0", slow as unknown as typeof fetch, 50);
    await expect(c.classify(sample)).rejects.toMatchObject({ code: "timeout" });
  });

  it("caps the response size and requires JSON content", async () => {
    const big = await failure(reply(`{"pad":"${"x".repeat(70_000)}"}`));
    expect([big.code, big.message]).toEqual(["invalid-response", "response too large"]);
    const html = await failure(reply(body(), { headers: { "content-type": "text/html" } }));
    expect(html.code).toBe("invalid-response");
  });

  const answers = body().answers;
  it.each([
    ["a different model version", body({ model: "jev-1.14.0" })],
    ["not JSON", "not json"],
    [
      "a label outside the taxonomy",
      body({ answers: { ...answers, primary: { ...answers.primary, choice: "spam" } } }),
    ],
    [
      "an incomplete distribution",
      body({
        answers: { ...answers, primary: { ...answers.primary, probabilities: { action: 1 } } },
      }),
    ],
    [
      "an unknown label in the distribution",
      body({
        answers: {
          ...answers,
          urgency: {
            ...answers.urgency,
            probabilities: { urgent: 0.1, not_urgent: 0.8, maybe: 0.1 },
          },
        },
      }),
    ],
    [
      "a distribution that does not sum to one",
      body({
        answers: {
          ...answers,
          urgency: { ...answers.urgency, probabilities: { urgent: 0.5, not_urgent: 0.9 } },
        },
      }),
    ],
    [
      "a chosen label that is not the most probable",
      body({ answers: { ...answers, urgency: { ...answers.urgency, choice: "urgent" } } }),
    ],
    [
      "a missing distribution",
      body({
        answers: { ...answers, primary: { type: "choice", choice: "action", confidence: 0.9 } },
      }),
    ],
    [
      "a confidence out of range",
      body({ answers: { ...answers, primary: { ...answers.primary, confidence: 1.5 } } }),
    ],
    ["a missing answer", body({ answers: { primary: answers.primary, urgency: answers.urgency } })],
    ["an extra answer", body({ answers: { ...answers, extra: { type: "noul", noul: 1 } } })],
    [
      "a wrong answer type",
      body({ answers: { ...answers, needs_reply: { type: "score", score: 3 } } }),
    ],
    ["negative usage", body({ usage: { input_tokens: -1 } })],
  ])("rejects %s", async (_name, value) => {
    const e = await failure(reply(value));
    expect(e.code).toBe("invalid-response");
  });

  it("accepts a tie for the chosen label", async () => {
    const tie = body({
      answers: {
        ...answers,
        urgency: {
          ...answers.urgency,
          choice: "urgent",
          probabilities: { urgent: 0.5, not_urgent: 0.5 },
        },
      },
    });
    const a = await classifier(reply(tie)).classify(sample);
    expect(a.urgency.label).toBe("urgent");
  });
});
