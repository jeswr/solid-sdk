// AUTHORED-BY Codex GPT-6.1-Sol
/** The blank-node label cannot be emitted as a Turtle/TriG BLANK_NODE_LABEL. */
export class UnsupportedBlankNodeLabelError extends TypeError {
  constructor() {
    super("Unsupported blank-node label");
    this.name = "UnsupportedBlankNodeLabelError";
  }
}

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

/** A supported scalar datatype has a noncanonical or invalid lexical form. */
export class UnsupportedLiteralLexicalFormError extends TypeError {
  constructor(readonly datatype: string) {
    super("Unsupported literal lexical form");
    this.name = "UnsupportedLiteralLexicalFormError";
  }
}
