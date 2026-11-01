// AUTHORED-BY Codex GPT-6.1-Sol
import { MailError } from "../model";
import { SearchQueryError } from "../search";
export class MailFileError extends Error {
  readonly code = "unsupported-file";
  constructor() {
    super("Unzip your Takeout and choose the .mbox file inside");
    this.name = "MailFileError";
  }
}
export function mailErrorMessage(error: unknown): string {
  if (error instanceof SearchQueryError || error instanceof MailFileError) return error.message;
  if (error instanceof MailError)
    return {
      "not-found": "This item isn't here any more",
      forbidden: "You don't have access to this",
      conflict: "This mail changed elsewhere. Refresh and try again.",
      "no-validator": "This storage can't safely update mail. Refresh and try again.",
      http: "Can't reach your storage. Try again.",
    }[error.code];
  if (error instanceof TypeError) return error.message;
  return "Couldn't finish the mail operation. Try again.";
}
export function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}
export async function* fileChunks(
  blob: Blob & { name?: string },
  chunkSize = 64 * 1024,
): AsyncGenerator<Uint8Array> {
  if (blob.name?.toLowerCase().endsWith(".zip") || blob.type === "application/zip")
    throw new MailFileError();
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new TypeError("Invalid chunk size");
  for (let offset = 0; offset < blob.size; offset += chunkSize)
    yield new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
}
