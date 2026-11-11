// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type AnswerModel, MAX_ANSWER_CHARS } from "@jeswr/pod-ask";

export type AskErrorCode = "not-configured" | "rate-limited" | "network" | "invalid";
export class AskModelError extends Error {
  constructor(readonly code: AskErrorCode) {
    super(code);
  }
}
export function hostedAnswerModel(send: typeof globalThis.fetch = globalThis.fetch): AnswerModel {
  return {
    async answer(question, passages, signal) {
      let response: Response;
      try {
        response = await send("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Explicit projection: no auth token, app route, recent history or other pod data.
          body: JSON.stringify({
            question,
            passages: passages.map(({ url, title, app, text, type, modified }) => ({
              url,
              title,
              app,
              text,
              type,
              modified,
            })),
          }),
          signal,
          cache: "no-store",
          credentials: "same-origin",
        });
      } catch {
        signal.throwIfAborted();
        throw new AskModelError("network");
      }
      signal.throwIfAborted();
      if (!response.ok)
        throw new AskModelError(
          response.status === 503
            ? "not-configured"
            : response.status === 429
              ? "rate-limited"
              : "network",
        );
      try {
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("text" in data) ||
          typeof data.text !== "string" ||
          !data.text.trim() ||
          data.text.length > MAX_ANSWER_CHARS
        )
          throw new TypeError();
        return data.text;
      } catch {
        throw new AskModelError("invalid");
      }
    },
  };
}
