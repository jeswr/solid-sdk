// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import { type Answers, questions } from "./guide";

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
export function validateTurn(input: unknown) {
  const r = z
    .object({ pathway, messages: messages.min(1), answers: answersSchema })
    .strict()
    .parse(input);
  return {
    pathway: r.pathway,
    messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
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
