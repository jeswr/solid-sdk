// AUTHORED-BY Codex GPT-6.1-Sol

/** A storage description discovery or validation failure (ADR-002). */
export class CapabilitiesError extends Error {
  override readonly name = "CapabilitiesError";

  constructor(
    public readonly code:
      | "no-storage-link"
      | "description-unreachable"
      | "description-invalid"
      | "root-mismatch"
      | "network",
    public readonly url: string,
    message: string = code,
    public readonly status?: number,
  ) {
    super(message);
  }
}
