// AUTHORED-BY Codex GPT-6.1-Sol
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { type FeedbackEnv, FeedbackError } from "./security";

export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const LIFETIME = 2 * 60 * 60 * 1000;
export const submissionIdSchema = z.uuid();
export const receiptSchema = z
  .object({
    submissionId: submissionIdSchema,
    sha: z.string().regex(/^[a-f0-9]{40,64}$/),
    size: z.number().int().min(1).max(MAX_AUDIO_BYTES),
    ext: z.enum(["webm", "ogg", "m4a"]),
    // Expiry travels inside sig.
    sig: z.string().regex(/^\d{13}\.[a-f0-9]{64}$/),
  })
  .strict();
export type AudioReceipt = z.infer<typeof receiptSchema>;
type BlobReceipt = Omit<AudioReceipt, "sig">;
function signature(receipt: BlobReceipt, expiry: number, env: FeedbackEnv): string {
  const secret = env.FEEDBACK_RECEIPT_SECRET?.trim() || env.FEEDBACK_GITHUB_TOKEN?.trim();
  if (!secret) throw new FeedbackError(503, "Feedback storage is unavailable. Download a copy.");
  const key = createHmac("sha256", secret)
    .update(`solid-suite-feedback-receipts:v2:${env.FEEDBACK_GITHUB_REPO?.trim() ?? ""}`)
    .digest();
  return createHmac("sha256", key)
    .update(`${receipt.submissionId}|${receipt.sha}|${receipt.size}|${receipt.ext}|${expiry}`)
    .digest("hex");
}
export function signReceipt(
  receipt: BlobReceipt,
  env: FeedbackEnv,
  now = Date.now(),
): AudioReceipt {
  const expiry = now + LIFETIME;
  return { ...receipt, sig: `${expiry}.${signature(receipt, expiry, env)}` };
}
export function verifyReceipts(
  input: unknown,
  submissionId: string,
  env: FeedbackEnv,
  now = Date.now(),
): AudioReceipt[] {
  const receipts = z.array(receiptSchema).max(10).parse(input);
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const [timestamp = "", digest = ""] = receipt.sig.split(".");
    const expiry = Number(timestamp);
    const valid = timingSafeEqual(
      Buffer.from(signature(receipt, expiry, env), "hex"),
      Buffer.from(digest, "hex"),
    );
    // Only this service can issue a signature for a known uploaded blob.
    if (
      !valid ||
      receipt.submissionId !== submissionId ||
      expiry <= now ||
      expiry > now + LIFETIME ||
      seen.has(receipt.sha)
    )
      throw new FeedbackError(
        400,
        "A recording receipt is invalid or expired. Download your feedback to keep it.",
      );
    seen.add(receipt.sha);
  }
  return receipts;
}
