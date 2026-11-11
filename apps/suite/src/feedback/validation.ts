// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import { type Answers, questionById, questions } from "./guide";

const answerFields = Object.fromEntries(
  questions.map((q) => [
    q.id,
    (q.type === "scale"
      ? z.union([
          z
            .number()
            .int()
            .min(1)
            .max(q.max ?? 7),
          z.literal("(skipped)"),
        ])
      : q.type === "multi"
        ? z.union([
            z.array(z.enum((q.options ?? []).map((o) => o.value))).max(q.max ?? 30),
            z.literal("(skipped)"),
          ])
        : q.type === "choice"
          ? z.union([z.enum((q.options ?? []).map((o) => o.value)), z.literal("(skipped)")])
          : z.string().max(4000)
    ).optional(),
  ]),
);
answerFields.summary = z.string().max(4000).optional();
export const answersSchema = z.object(answerFields).strict();
const pathway = z.enum(["guided", "quick"]);
export const messageSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })
  .strict();
const messages = z.array(messageSchema).max(40);
export type Message = z.infer<typeof messageSchema>;
export function validateAnswers(input: unknown): Answers {
  return answersSchema.parse(input) as Answers;
}
/** Map a model-written option (its value or its label, any case) to the option value. */
function optionValue(id: string, raw: string): string | undefined {
  const wanted = raw.trim().toLowerCase();
  const option = questionById(id)?.options?.find(
    (o) => o.value.toLowerCase() === wanted || o.label.toLowerCase() === wanted,
  );
  return option?.value;
}
/**
 * Convert the small model wire format, then apply the existing answer constraints field by
 * field. A value the model got wrong is dropped (the interviewer asks again) instead of
 * failing the whole turn.
 */
export function coerceUpdates(updates: { id: string; value: string }[]): Answers {
  const answers: Answers = {};
  for (const { id, value } of updates) {
    const q = questionById(id);
    if (!q && id !== "summary") continue;
    let candidate: Answers[string];
    if (value === "(skipped)") candidate = value;
    else if (q?.type === "scale") {
      const number = Number(value.trim());
      // Refuse fractional, non-numeric and out-of-range ratings rather than inventing one.
      if (!value.trim() || !Number.isInteger(number) || number < 1 || number > (q.max ?? 7))
        continue;
      candidate = number;
    } else if (q?.type === "multi") {
      const picked = value
        .split("|")
        .map((v) => optionValue(id, v))
        .filter((v): v is string => v !== undefined);
      if (!picked.length) continue;
      candidate = [...new Set(picked)];
    } else if (q?.type === "choice") {
      const picked = optionValue(id, value);
      if (!picked) continue;
      candidate = picked;
    } else candidate = value;
    if (answerFields[id]?.safeParse(candidate).success) answers[id] = candidate;
  }
  return validateAnswers(answers);
}
export const MAX_TURN_CHARACTERS = 24_000;
export function validateTurn(input: unknown) {
  const r = z
    .object({ pathway, messages: messages.min(1), answers: answersSchema })
    .strict()
    .refine(
      (r) =>
        r.messages.at(-1)?.role === "user" &&
        r.messages.every((m, i) => i === 0 || m.role !== r.messages[i - 1]?.role),
      "Conversation must strictly alternate and end with a user answer.",
    )
    .parse(input);
  // Keep the opening and newest exchange, dropping older pairs to preserve alternation.
  const bounded = [...r.messages];
  const contextSize = JSON.stringify(r.answers).length + 80;
  const total = () => contextSize + bounded.reduce((n, m) => n + m.content.length, 0);
  while (total() > MAX_TURN_CHARACTERS && bounded.length > 3) bounded.splice(1, 2);
  z.number().max(MAX_TURN_CHARACTERS).parse(total());
  return {
    pathway: r.pathway,
    messages: bounded.map((m) => ({ role: m.role, content: m.content })),
    answers: validateAnswers(r.answers),
  };
}
export const submissionSchema = z
  .object({
    pathway,
    answers: answersSchema,
    transcript: z
      .array(
        messageSchema
          .extend({ audio: z.array(z.number().int().min(0).max(9)).max(10).optional() })
          .strict(),
      )
      .max(160),
    contact: z
      .object({ name: z.string().max(120), email: z.union([z.literal(""), z.email().max(254)]) })
      .strict(),
    metadata: z
      .object({
        version: z.string().max(100),
        commit: z.string().max(100),
        userAgent: z.string().max(1000),
        walkthrough: z.array(z.string().max(60)).max(30),
      })
      .strict(),
  })
  .strict();
export type Submission = z.infer<typeof submissionSchema> & { answers: Answers };
export function validateSubmission(input: unknown): Submission {
  const r = submissionSchema.parse(input);
  return {
    pathway: r.pathway,
    answers: validateAnswers(r.answers),
    transcript: r.transcript.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.audio ? { audio: [...m.audio] } : {}),
    })),
    contact: { name: r.contact.name, email: r.contact.email },
    metadata: {
      version: r.metadata.version,
      commit: r.metadata.commit,
      userAgent: r.metadata.userAgent,
      walkthrough: [...r.metadata.walkthrough],
    },
  };
}
