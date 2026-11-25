// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import {
  asFailure,
  classifyFailure,
  FeedbackFailure,
  failureMessage,
  feedbackResponse,
} from "../src/feedback/client-errors";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });
const failureOf = async (response: Response) =>
  feedbackResponse(response).then(
    () => {
      throw new Error("expected a failure");
    },
    (error) => error as FeedbackFailure,
  );

describe("classifying answers", () => {
  it.each([
    [400, false, "invalid", "invalid", false],
    [400, false, undefined, "invalid", false],
    [400, false, "receipts_invalid", "receipts", false],
    [422, false, undefined, "invalid", false],
    [409, false, "conflict", "conflict", false],
    [413, false, undefined, "too-large", false],
    [415, false, undefined, "unsupported", false],
    [429, true, "rate_limited", "rate-limited", false],
    [503, true, "storage_busy", "retry-later", true],
    [503, true, undefined, "retry-later", true],
    [429, true, undefined, "retry-later", true],
    [503, false, "unavailable", "unavailable", false],
    [503, false, undefined, "unknown", true],
    [502, false, "upstream", "unknown", true],
    [500, false, undefined, "unknown", true],
    [502, false, "surprise", "unknown", true],
  ])("%i (retry-after %s, code %s) is %s; may have stored: %s", (status, retryAfter, code, kind, stored) => {
    const failure = classifyFailure(status, retryAfter, code);
    expect(failure.kind).toBe(kind);
    expect(failure.mayHaveStored).toBe(stored);
  });
  it("lets a recognised code override the status", () => {
    expect(classifyFailure(502, false, "rate_limited").kind).toBe("rate-limited");
  });
  it("treats anything that is not a classified failure as uncertain", () => {
    expect(asFailure(new TypeError("network")).mayHaveStored).toBe(true);
    const known = new FeedbackFailure("conflict", false);
    expect(asFailure(known)).toBe(known);
  });
});

describe("reading responses", () => {
  it("returns a JSON object", async () => {
    expect(await feedbackResponse(json({ reference: 4 }))).toEqual({ reference: 4 });
  });
  it("reads the code of a JSON error and ignores bodies that are not JSON", async () => {
    expect(
      (await failureOf(json({ code: "rate_limited" }, 429, { "Retry-After": "5" }))).kind,
    ).toBe("rate-limited");
    expect((await failureOf(json({ code: "receipts_invalid" }, 400))).kind).toBe("receipts");
    const html = new Response("<html>413</html>", {
      status: 413,
      headers: { "content-type": "text/html" },
    });
    expect((await failureOf(html)).kind).toBe("too-large");
    const broken = new Response("{", {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    expect((await failureOf(broken)).kind).toBe("invalid");
  });
  it("rejects a successful answer that is not a JSON object", async () => {
    await expect(feedbackResponse(new Response("ok", { status: 200 }))).rejects.toThrow(
      "Feedback request failed.",
    );
    await expect(feedbackResponse(json([1]))).rejects.toThrow("unavailable");
    const broken = new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(feedbackResponse(broken)).rejects.toThrow("unavailable");
    await expect(feedbackResponse(json(null))).rejects.toThrow("unavailable");
  });
});

describe("messages", () => {
  const here = { recordingsHere: true, stage: "submit" as const };
  const gone = { recordingsHere: false, stage: "submit" as const };
  it("gives each failure its own accurate message", () => {
    const kinds = [
      "retry-later",
      "rate-limited",
      "unavailable",
      "receipts",
      "conflict",
      "too-large",
      "unsupported",
      "invalid",
      "unknown",
    ] as const;
    const messages = kinds.map((kind) => failureMessage(kind, here));
    expect(new Set(messages).size).toBe(kinds.length);
    expect(failureMessage("rate-limited", here)).toContain("allowance");
    expect(failureMessage("unavailable", here)).toContain("isn't switched on");
    expect(failureMessage("conflict", here)).toContain("Start a new submission");
    // A permanent failure must never be presented as "try again".
    for (const kind of ["conflict", "too-large", "unsupported", "unavailable"] as const)
      expect(failureMessage(kind, here)).not.toMatch(/try again/i);
    expect(failureMessage("invalid", here)).toContain("email address");
  });
  it("only claims recordings are still here when they are", () => {
    for (const kind of ["retry-later", "rate-limited", "unavailable", "unknown"] as const) {
      expect(failureMessage(kind, here)).toContain("answers and recordings are still here");
      expect(failureMessage(kind, gone)).not.toContain("recordings are still here");
      expect(failureMessage(kind, gone)).toContain("Your answers are still here");
    }
    expect(failureMessage("receipts", here)).toContain("upload them again");
    expect(failureMessage("receipts", gone)).not.toContain("upload them again");
  });
  it("words upload failures about the recording", () => {
    const upload = { recordingsHere: true, stage: "upload" as const };
    expect(failureMessage("invalid", upload)).toContain("A recording was rejected");
    expect(failureMessage("unsupported", upload)).toContain("recording");
    expect(failureMessage("unknown", upload)).toContain("Your audio is still here");
    expect(failureMessage("unknown", { recordingsHere: false, stage: "upload" })).not.toContain(
      "audio is still here",
    );
    expect(failureMessage("unsupported", here)).toContain("feedback");
  });
});
