// AUTHORED-BY Codex GPT-6.1-Sol
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { validateAudio } from "./audio";
import { questionById } from "./guide";
import { buildModelRequest } from "./prompt";
import { MAX_AUDIO_BYTES, verifyReceipts } from "./receipts";
import {
  allowedOrigin,
  type FeedbackEnv,
  FeedbackError,
  json,
  rateLimiter,
  readBody,
  visitorOf,
} from "./security";
import { createGithubStore, type FeedbackStore } from "./store";
import { coerceUpdates, validateAnswers, validateSubmission, validateTurn } from "./validation";

type ModelRequest = ReturnType<typeof buildModelRequest>;
export interface InterviewClient {
  complete(request: ModelRequest): Promise<string>;
}
const anthropicClient = (key: string): InterviewClient => ({
  async complete(request) {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 60_000, logLevel: "off" });
    const response = await client.messages.create(request);
    if (response.stop_reason !== "end_turn")
      throw new FeedbackError(
        502,
        "The interviewer couldn't finish that reply. Your feedback is still here.",
      );
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  },
});
export function createFeedbackHandlers(options: {
  env: FeedbackEnv;
  client?: InterviewClient;
  store?: FeedbackStore;
  limiter?: typeof rateLimiter;
}) {
  const { env } = options;
  const limiter = options.limiter ?? rateLimiter;
  // Recheck repository privacy and current credentials for each upload/submission.
  const storage = () => options.store ?? createGithubStore(env);
  async function protect(
    request: Request,
    kind: "turn" | "submit" | "audio",
    action: () => Promise<Response>,
  ): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (!origin)
      return json({ error: "Feedback is available from the suite's own pages only." }, 403);
    const headers = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    try {
      const wait = limiter(visitorOf(request), kind);
      if (wait !== undefined)
        return json(
          {
            error:
              "You've reached the feedback allowance. Please try again later, or download your feedback.",
          },
          429,
          { ...headers, "Retry-After": String(Math.ceil(wait / 1000)) },
        );
      const response = await action();
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof FeedbackError)
        return json({ error: error.message }, error.status, headers);
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)
        return json(
          { error: "The feedback request is not valid. Check the fields and try again." },
          400,
          headers,
        );
      return json(
        {
          error:
            "We couldn't save or process that feedback. Your feedback is still here. You can download a copy.",
        },
        502,
        headers,
      );
    }
  }
  return {
    get(request?: Request) {
      const origin = request && allowedOrigin(request, env);
      return json(
        { hosted: Boolean(env.ANTHROPIC_API_KEY?.trim()) },
        200,
        origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {},
      );
    },
    options(request: Request) {
      const origin = allowedOrigin(request, env);
      return origin
        ? new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
              Vary: "Origin",
            },
          })
        : json({ error: "Origin not allowed." }, 403);
    },
    turn(request: Request) {
      return protect(request, "turn", async () => {
        if (!request.headers.get("content-type")?.startsWith("application/json"))
          throw new FeedbackError(415, "Send JSON.");
        const input = validateTurn(
          JSON.parse(new TextDecoder().decode(await readBody(request, 240_000))),
        );
        const key = env.ANTHROPIC_API_KEY?.trim();
        if (!key)
          throw new FeedbackError(
            503,
            "The interviewer isn't switched on yet. You can still use the plain feedback form.",
          );
        let result: unknown;
        try {
          result = JSON.parse(
            await (options.client ?? anthropicClient(key)).complete(
              buildModelRequest(input, env.FEEDBACK_MODEL?.trim() || undefined),
            ),
          );
        } catch {
          throw new FeedbackError(
            502,
            "The interviewer couldn't reply. Your answer is still here. Try again or use the plain form.",
          );
        }
        const r = z
          .object({
            reply: z.string().min(1).max(4000),
            updates: z
              .array(z.object({ id: z.string(), value: z.string().max(4000) }).strict())
              .max(100),
            nextQuestionId: z.string(),
            done: z.boolean(),
          })
          .strict()
          .parse(result);
        const answers = coerceUpdates(r.updates);
        const merged = validateAnswers({ ...input.answers, ...answers });
        const question = r.nextQuestionId !== "none" ? questionById(r.nextQuestionId) : undefined;
        if (r.nextQuestionId !== "none" && !question)
          throw new FeedbackError(
            502,
            "The interviewer returned an unknown question. Please use the plain form.",
          );
        const lastUser = input.messages.at(-1);
        const confirmation =
          input.answers.confirmed === "yes" ||
          (lastUser?.role === "user" &&
            /^(yes|yes[, .]?( that.s right)?|correct|that.s right)[.!]?$/i.test(
              lastUser.content.trim(),
            ));
        if (!confirmation) delete merged.confirmed;
        const done =
          r.done &&
          confirmation &&
          Boolean(input.answers.summary) &&
          merged.confirmed === "yes" &&
          Boolean(merged.summary);
        if (!done && !question)
          throw new FeedbackError(
            502,
            "The interviewer couldn't choose a next question. Please use the plain form.",
          );
        return json({ reply: r.reply, answers: merged, ...(question ? { question } : {}), done });
      });
    },
    audio(request: Request) {
      return protect(request, "audio", async () => {
        const bytes = await readBody(request, MAX_AUDIO_BYTES);
        const file = new File([bytes as Uint8Array<ArrayBuffer>], "recording", {
          type: request.headers.get("content-type") ?? "",
        });
        return json(await storage().upload(await validateAudio(file)));
      });
    },
    submit(request: Request) {
      return protect(request, "submit", async () => {
        if (!request.headers.get("content-type")?.startsWith("application/json"))
          throw new FeedbackError(415, "Send JSON feedback with recording receipts.");
        const data = z
          .object({ record: z.unknown(), receipts: z.unknown() })
          .strict()
          .parse(JSON.parse(new TextDecoder().decode(await readBody(request, 1_000_000))));
        const submission = validateSubmission(data.record);
        const receipts = verifyReceipts(data.receipts, env);
        if (submission.transcript.some((m) => m.audio?.some((i) => i >= receipts.length)))
          throw new FeedbackError(400, "A recording is missing from the feedback.");
        return json(await storage().save(submission, receipts));
      });
    },
  };
}
