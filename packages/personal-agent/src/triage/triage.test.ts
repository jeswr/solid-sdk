import { describe, expect, it, vi } from "vitest";
import { carrierFor } from "../pilot/bindings/email.js";
import type { ClassifierAnswer, TriageClassifier } from "./classifier.js";
import { ClassifierError } from "./classifier.js";
import { SYNTHETIC_CORPUS } from "./corpus.js";
import { baselineTriage } from "./deterministic.js";
import { evaluate } from "./evaluate.js";
import { isAgentProtocolMessage, triageSample } from "./triage.js";

const sample = { from: "ana@example.org", subject: "Lunch?", body: "Are you free on Thursday?" };

function answer(over: Partial<ClassifierAnswer> = {}): ClassifierAnswer {
  return {
    primary: {
      label: "needs_reply",
      probability: 0.9,
      confidence: 0.9,
      probabilities: {
        needs_reply: 0.9,
        action: 0.02,
        waiting: 0.02,
        read_later: 0.02,
        fyi: 0.02,
        noise: 0.01,
        uncertain: 0.01,
      },
    },
    urgency: {
      label: "not_urgent",
      probability: 0.95,
      confidence: 0.93,
      probabilities: { urgent: 0.05, not_urgent: 0.95 },
    },
    needsReply: 0.93,
    model: "jev-1.13.0",
    ...over,
  };
}

function fake(
  result: ClassifierAnswer | Error,
): TriageClassifier & { classify: ReturnType<typeof vi.fn> } {
  return {
    provider: "Fake",
    model: "jev-1.13.0",
    classify: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("structured agent messages keep the deterministic path", () => {
  const envelope = JSON.stringify({
    format: "awp-jws-compact/0.1",
    jws: "eyJhbGciOiJFZERTQSJ9.e30.sig",
  });
  const carried = carrierFor({
    format: "awp-jws-compact/0.1",
    jws: "eyJhbGciOiJFZERTQSJ9.e30.sig",
  } as never);

  it.each([
    ["a JSON envelope", envelope],
    ["the email binding's SignedMessage carrier", carried],
    ["an unsigned public request", JSON.stringify({ format: "awp-unsigned-json/0.1" })],
    ["X-AWP headers", "X-AWP-Profile: https://example.org/p\n\nhello"],
  ])("never sends %s to a classifier", async (_name, body) => {
    expect(isAgentProtocolMessage(body)).toBe(true);
    const c = fake(answer());
    const r = await triageSample(
      { subject: "Meeting", body },
      { classifier: c, allowed: true, why: "test" },
    );
    expect(r.route).toBe("agent-protocol");
    expect(r.source).toBe("none");
    expect(r.mayAct).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/proves nothing/);
    expect(c.classify).not.toHaveBeenCalled();
  });

  it("plain text is not mistaken for an agent message", () => {
    expect(isAgentProtocolMessage("Can we talk about the AWP project?")).toBe(false);
  });
});

describe("hosted suggestions are gated, thresholded and never authorise", () => {
  it("does not call the classifier unless allowed", async () => {
    const c = fake(answer());
    const r = await triageSample(sample, {
      classifier: c,
      allowed: false,
      why: "Hosted triage is turned off.",
    });
    expect(c.classify).not.toHaveBeenCalled();
    expect(r.hosted).toEqual({ status: "not-allowed", detail: "Hosted triage is turned off." });
    expect(r.source).toBe("deterministic-baseline");
    const none = await triageSample(sample);
    expect(none.hosted.status).toBe("not-requested");
  });

  it("uses a confident answer as a suggestion only", async () => {
    const r = await triageSample(sample, { classifier: fake(answer()), allowed: true, why: "" });
    expect(r).toMatchObject({
      source: "typesafe",
      primary: "needs_reply",
      urgency: "not_urgent",
      needsReply: "yes",
      askOwner: [],
      mayAct: false,
      model: "jev-1.13.0",
      probability: { primary: 0.9, urgency: 0.95 },
    });
    expect(r.distribution?.primary.needs_reply).toBe(0.9);
  });

  it("low confidence OR low chosen-label probability becomes uncertain and asks the owner", async () => {
    const lowConfidence = answer();
    lowConfidence.primary = { ...lowConfidence.primary, confidence: 0.4 };
    const lowProbability = answer();
    lowProbability.primary = { ...lowProbability.primary, probability: 0.5 };
    for (const a of [lowConfidence, lowProbability]) {
      const r = await triageSample(sample, { classifier: fake(a), allowed: true, why: "" });
      expect(r.primary).toBe("uncertain");
      expect(r.primaryCandidate).toBe("needs_reply");
      expect(r.askOwner).toContain("classification");
    }
    const middling = await triageSample(sample, {
      classifier: fake(answer({ needsReply: 0.5 })),
      allowed: true,
      why: "",
    });
    expect(middling.needsReply).toBe("uncertain");
    expect(middling.askOwner).toContain("whether a reply is needed");
  });

  it("the model's own abstention stays uncertain with no candidate", async () => {
    const a = answer();
    a.primary = { ...a.primary, label: "uncertain", probability: 0.95, confidence: 0.95 };
    const r = await triageSample(sample, { classifier: fake(a), allowed: true, why: "" });
    expect(r.primary).toBe("uncertain");
    expect(r.primaryCandidate).toBeUndefined();
  });

  it.each([
    ["timeout", new ClassifierError("timeout", "no answer within 10000 ms"), "failed"],
    [
      "invalid",
      new ClassifierError("invalid-response", "the answer did not match"),
      "invalid-response",
    ],
    ["unexpected", new Error("socket hang up key=secret"), "failed"],
  ])("a %s failure falls back to local rules and asks the owner", async (_n, error, status) => {
    const r = await triageSample(sample, {
      classifier: fake(error as Error),
      allowed: true,
      why: "",
    });
    expect(r.source).toBe("deterministic-baseline");
    expect(r.hosted.status).toBe(status);
    expect(r.askOwner.length).toBeGreaterThan(0);
    expect(r.mayAct).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("the local baseline always stays below the thresholds (it always asks)", async () => {
    for (const item of SYNTHETIC_CORPUS) {
      const r = await triageSample(item.sample);
      expect(r.primary).toBe("uncertain");
      expect(r.askOwner.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluation over the labelled synthetic corpus", () => {
  it("reports answered/abstained counts, a confusion matrix and errors", async () => {
    const report = await evaluate(SYNTHETIC_CORPUS, (item) => triageSample(item.sample));
    expect(report.items).toBe(SYNTHETIC_CORPUS.length);
    expect(report.answered + report.abstained).toBe(report.items);
    expect(report.abstained).toBe(report.items); // the baseline never answers on its own
    expect(report.candidateAccuracy).toBeGreaterThan(0);
    const matrixTotal = Object.values(report.confusion)
      .flatMap((row) => Object.values(row))
      .reduce((a, b) => a + b, 0);
    expect(matrixTotal).toBe(report.items);
    expect(report.errors.length).toBe(
      SYNTHETIC_CORPUS.filter((i) => baselineTriage(i.sample).primary !== i.primary).length,
    );
  });
});
