// AUTHORED-BY Codex GPT-6.1-Sol
/** The literal's datatype is outside the supported RDFlib parity contract. */
export class UnsupportedLiteralDatatypeError extends TypeError {
  constructor(readonly datatype: string) {
    super("Unsupported literal datatype");
    this.name = "UnsupportedLiteralDatatypeError";
  }
}

/** The literal contains a Python line separator excluded from the parity contract. */
export class UnsupportedLiteralCharacterError extends TypeError {
  constructor(readonly codePoint: number) {
    super("Unsupported literal line separator");
    this.name = "UnsupportedLiteralCharacterError";
  }
}
