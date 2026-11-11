// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { createFeedbackHandlers } from "../src/feedback/server";

it.skipIf(process.env.FEEDBACK_LIVE_TEST !== "1" || !process.env.ANTHROPIC_API_KEY?.trim())(
  "accepts the emitted schema for one real interview turn",
  async () => {
    const handlers = createFeedbackHandlers({
      env: { ...process.env, FEEDBACK_ALLOWED_ORIGINS: "https://suite.test" },
      limiter: () => undefined,
    });
    const response = await handlers.turn(
      new Request("https://suite.test/api/feedback/turn", {
        method: "POST",
        headers: { Origin: "https://suite.test", "Content-Type": "application/json" },
        body: JSON.stringify({
          pathway: "quick",
          answers: {},
          messages: [
            {
              role: "user",
              content: "Drive sorting was confusing. I expected newest files first.",
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.reply).toEqual(expect.any(String));
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.question?.id).toEqual(expect.any(String));
    expect(result.done).toBe(false);
  },
  120_000,
);
