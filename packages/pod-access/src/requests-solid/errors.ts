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

/** The owner withdrew this approval (its records say so), so finishing it would re-grant access. */
export class ApprovalRevokedError extends Error {
  constructor() {
    super(
      "This approval was revoked after it was recorded, so it will not be finished. Deny the request or ask for a new one",
    );
    this.name = "ApprovalRevokedError";
  }
}
