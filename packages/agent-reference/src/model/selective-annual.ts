// AUTHORED-BY Codex GPT-6
/** One signed disclosure projects annual payroll and employer, never its hidden siblings. */
import type { JsonObject } from "../core/types.js";
import { SuiteValuesNode } from "./suite-values.js";
export function projectSelectiveAnnual(input: JsonObject): JsonObject {
  if (input.claimType !== "income.gross.annual") return input;
  const disclosure = SuiteValuesNode.fromSignedPayload(input),
    value = disclosure.node("value");
  if (
    !value ||
    !value.fieldsOnly([
      "type",
      "version",
      "currency",
      "period",
      "annualGrossIncome",
      "employerName",
      "issuedAt",
      "synthetic",
    ]) ||
    value.string("type") !== "EvidenceStatement" ||
    typeof value.number("annualGrossIncome") !== "number" ||
    !value.string("employerName")
  )
    throw new TypeError("invalid annual payroll projection");
  const { value: _value, ...metadata } = input;
  return { ...value.toObject(), ...metadata };
}
