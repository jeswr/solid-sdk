// AUTHORED-BY Codex GPT-6
import type { Nanopublication } from "./model.js";

/** Shared eligibility for revision links and their generated invalidation times. */
export function canRevise(
  np: Pick<Nanopublication, "epistemic" | "validity">,
  options: { invalidated?: boolean; envelopeTarget?: boolean } = {},
): boolean {
  // Envelope withdrawals retire any target, including mentions. Preserve legacy
  // assertion-wide factual withdrawals; a mention needs an explicit envelope.
  if (np.validity === "Retracted")
    return options.envelopeTarget === true || np.epistemic !== "Mentioned";
  return (
    np.epistemic !== "Mentioned" &&
    (np.validity === "Current" || np.validity === "Contradicted") &&
    !options.invalidated
  );
}
