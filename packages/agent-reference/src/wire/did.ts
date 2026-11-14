// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { parseBoundedJson } from "../core/limits.js";
import { assertUniqueKeys } from "./document.js";

const documentSchema = z.strictObject({
  "@context": z.tuple([
    z.literal("https://www.w3.org/ns/did/v1"),
    z.literal("https://w3id.org/security/multikey/v1"),
  ]),
  id: z.string(),
  verificationMethod: z
    .array(
      z.strictObject({
        id: z.string(),
        type: z.literal("Multikey"),
        controller: z.string(),
        publicKeyMultibase: z.string(),
      }),
    )
    .length(1),
  assertionMethod: z.array(z.string()).length(1),
});

export function readDidDocument(bytes: string) {
  if (Buffer.byteLength(bytes) > 16384) throw new TypeError("DID document too large");
  assertUniqueKeys(bytes);
  return documentSchema.safeParse(parseBoundedJson(bytes));
}
