// AUTHORED-BY Codex GPT-6

/** Form derivation cannot preserve named-graph data or shape semantics. */
export class FormGraphUnsupportedError extends TypeError {
  override readonly name = "FormGraphUnsupportedError";
  constructor(readonly input: "data" | "shapes") {
    super(`deriveForm supports only default-graph quads; ${input} contains a named graph`);
  }
}

/** A generated anonymous trace identifier aliases a named node in a malformed policy. */
export class PolicyIdentifierCollisionError extends TypeError {
  override readonly name = "PolicyIdentifierCollisionError";
  constructor(readonly identifier: string) {
    super(`Malformed policy: generated trace identifier collides with a named node: ${identifier}`);
  }
}

/** The projected policy ID cannot identify exactly one typed RDF subject. */
export class PolicySubjectUnsupportedError extends TypeError {
  override readonly name = "PolicySubjectUnsupportedError";
  constructor(readonly identifier: string) {
    super(`Policy trace requires one unambiguous typed subject for: ${identifier}`);
  }
}
