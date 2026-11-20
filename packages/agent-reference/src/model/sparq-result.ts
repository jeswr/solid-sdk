// AUTHORED-BY Codex GPT-6
/** The small RDF claim projection used solely by sparq's non-VC test credentials. */
import { DataFactory, Writer } from "n3";
import { z } from "zod";
import { isIri } from "../core/canonical.js";

const claim = z.object({
  subject: z.string().refine(isIri),
  claimType: z.string(),
  value: z.union([z.string(), z.number().int().safe(), z.boolean()]),
  datatype: z.string().refine(isIri).optional(),
});
const claims = z.strictObject({ statements: z.array(claim).min(1).max(16) });
export function writeCredentialClaims(
  writer: Writer,
  subject: string,
  value: unknown,
  predicate = (kind: string) => `urn:claim:${encodeURIComponent(kind)}`,
): void {
  const parsed = claims.parse(value);
  const xsd = "http://www.w3.org/2001/XMLSchema#";
  for (const item of parsed.statements) {
    if (item.subject !== subject) throw new Error("credential subject mismatch");
    const datatype =
      item.datatype ??
      `${xsd}${typeof item.value === "boolean" ? "boolean" : typeof item.value === "number" ? "integer" : "string"}`;
    writer.addQuad(
      DataFactory.namedNode(subject),
      DataFactory.namedNode(predicate(item.claimType)),
      DataFactory.literal(String(item.value), DataFactory.namedNode(datatype)),
    );
  }
}

export function finishCredentialGraph(writer: Writer): Promise<string> {
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

export function resultCredentialGraph(subject: string, value: unknown): Promise<string> {
  const writer = new Writer({ format: "N-Quads" });
  writeCredentialClaims(writer, subject, value);
  return finishCredentialGraph(writer);
}
