// AUTHORED-BY Codex GPT-6.1-Sol
export type PhoneNumberErrorCode =
  | "invalid-input"
  | "invalid-region"
  | "missing-region"
  | "invalid-format"
  | "invalid-extension"
  | "unsupported-number";

/** Messages deliberately exclude phone numbers and other caller data. */
export class PhoneNumberError extends Error {
  constructor(public readonly code: PhoneNumberErrorCode) {
    super(`Phone number: ${code}`);
    this.name = "PhoneNumberError";
  }
}
