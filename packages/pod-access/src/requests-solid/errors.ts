// AUTHORED-BY Codex GPT-6.1-Sol
/** Unknown/mixed models or an ACP dialect/shape the roles layer cannot safely write. */
export class UnsupportedAccessModelError extends Error {
  constructor(readonly model: "acp" | "unknown") {
    super(`Cannot materialise access requests on an ${model} access model`);
    this.name = "UnsupportedAccessModelError";
  }
}
