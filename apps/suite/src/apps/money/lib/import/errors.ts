// AUTHORED-BY Codex GPT-6.1-Sol
/** A statement cannot be safely imported. Messages never include statement contents. */
export class BankImportError extends Error {
  override readonly name = "BankImportError";
}

/** Bound input before parsing, counting the UTF-8 bytes of the decoded text. */
export function assertImportSize(text: string): void {
  const limit = 10 * 1024 * 1024;
  if (text.length > limit || new TextEncoder().encode(text).byteLength > limit)
    throw new BankImportError("Statement exceeds the 10 MiB import limit");
}
