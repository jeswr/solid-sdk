// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  buildGroundedPrompt,
  MAX_ANSWER_CHARS,
  MAX_PASSAGE_CHARS,
  MAX_PASSAGES,
  MAX_QUESTION_CHARS,
  type Passage,
  sourceUrl,
} from "@jeswr/pod-ask";
import { z } from "zod";
import {
  allowedOrigin,
  createLimiter,
  type FeedbackEnv,
  FeedbackError,
  json,
  readBody,
  visitorOf,
} from "@/feedback/security";

export const ASK_MODEL = "claude-opus-5-5";
export const ASK_REQUEST_BYTES = 64000;
const passage = z
  .object({
    url: z
      .string()
      .max(2048)
      .refine((value) => Boolean(sourceUrl(value))),
    title: z.string().max(300),
    app: z.string().max(60),
    text: z.string().min(1).max(MAX_PASSAGE_CHARS),
    type: z.string().max(200).optional(),
    modified: z.string().max(40).optional(),
  })
  .strict();
const input = z
  .object({
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    passages: z.array(passage).min(1).max(MAX_PASSAGES),
  })
  .strict();
type Completion = (
  prompt: ReturnType<typeof buildGroundedPrompt>,
  signal: AbortSignal,
) => Promise<string>;
// Reuse feedback's process/visitor caps, with an independent allowance for Ask.
const limiter = createLimiter();

export function createAskHandler(options: {
  env: FeedbackEnv;
  complete: Completion;
  limit?: typeof limiter;
}) {
  return async (request: Request): Promise<Response> => {
    if (!allowedOrigin(request, options.env)) return json({ error: "origin-not-allowed" }, 403);
    const wait = (options.limit ?? limiter)(visitorOf(request), "turn");
    if (wait !== undefined)
      return json({ error: "rate-limited" }, 429, {
        "Retry-After": String(Math.ceil(wait / 1000)),
      });
    if (!options.env.ANTHROPIC_API_KEY?.trim()) return json({ error: "not configured" }, 503);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return json({ error: "send-json" }, 415);
    let question: string;
    let passages: Passage[];
    try {
      const parsed = input.parse(
        JSON.parse(new TextDecoder().decode(await readBody(request, ASK_REQUEST_BYTES))),
      );
      question = parsed.question;
      passages = parsed.passages;
      // Never silently drop evidence: citation numbering must match the browser's list.
      const prompt = buildGroundedPrompt(question, passages, {
        maxTotalChars: 32000,
        maxPassageChars: MAX_PASSAGE_CHARS,
      });
      if (
        prompt.passages.length !== passages.length ||
        prompt.passages.some((p, i) => p.text !== passages[i]?.text)
      )
        return json({ error: "passages-too-large" }, 413);
      try {
        const text = await options.complete(prompt, request.signal);
        if (!text.trim() || text.length > MAX_ANSWER_CHARS)
          return json({ error: "invalid-answer" }, 502);
        return json({ text });
      } catch (error) {
        // Never expose provider errors: they may include snippets or credentials.
        const status =
          error && typeof error === "object" && "status" in error ? error.status : undefined;
        return json(
          { error: status === 429 ? "rate-limited" : "answer-unavailable" },
          status === 429 ? 429 : 502,
        );
      }
    } catch (error) {
      return json(
        { error: "invalid-request" },
        error instanceof FeedbackError ? error.status : 400,
      );
    }
  };
}
