// AUTHORED-BY Codex GPT-6
/** Foreign unsigned source bytes and locator parsing end at this RDF ingress boundary. */
import { z } from "zod";
import { parseBoundedJson } from "../core/limits.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import { assertUniqueKeys } from "./document.js";

const locatorSchema = z.strictObject({
  source: z.string().url(),
  recordId: z.string(),
  pointer: z.string().url(),
  anchor: z.string().max(16384),
});
export function originLocator(value: string): SuiteValuesNode {
  assertUniqueKeys(value);
  return SuiteValuesNode.fromSignedPayload(locatorSchema.parse(parseBoundedJson(value)));
}
export function unsignedOriginRecord(value: string): SuiteValuesNode {
  assertUniqueKeys(value);
  const parsed = z
    .object({
      id: z.string(),
      issuer: z.string().url(),
      claimType: z.literal("mortgage.product"),
      method: z.literal("published-by-lender"),
      issuedAt: z.iso.datetime(),
    })
    .passthrough()
    .parse(parseBoundedJson(value));
  if ("proof" in parsed || "signature" in parsed)
    throw new TypeError("Origin record must be unsigned");
  return SuiteValuesNode.fromSignedPayload(parsed);
}
