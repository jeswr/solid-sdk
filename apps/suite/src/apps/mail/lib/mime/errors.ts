// AUTHORED-BY Codex GPT-6
/** Input that cannot be represented safely by the library's flat attachment API. */
export class MimeParseError extends Error {
  readonly code = "EAMBIGUOUSCID";

  constructor() {
    super("Selected MIME alternatives reuse a Content-ID");
    this.name = "MimeParseError";
  }
}
