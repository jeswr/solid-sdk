// AUTHORED-BY Codex GPT-6.1-Sol
/** Unknown/mixed models or an ACP dialect/shape the roles layer cannot safely write. */
export class UnsupportedAccessModelError extends Error {
  constructor(readonly model: "acp" | "unknown") {
    super(`Cannot materialise access requests on an ${model} access model`);
    this.name = "UnsupportedAccessModelError";
  }
}

/** The decision no longer grants exactly the scope shown on the consent screen. */
export class DecisionPreviewConflictError extends Error {
  constructor() {
    super("The decision differs from its preview; review the updated targets and roles first");
    this.name = "DecisionPreviewConflictError";
  }
}
