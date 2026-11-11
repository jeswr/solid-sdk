// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWritableQuads, isSafeAbsoluteIri, type ManifestEntity } from "@jeswr/model-runtime";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import model, { type ClientConnectionData, entities } from "./generated/model.js";
import { connectionsContainer } from "./layout.js";

export type ConnectionRecord = ClientConnectionData;
export type ConnectionState = "live" | "revoked" | "unavailable";
const entity = entities.ClientConnection;
const invalid = () => new Error("Invalid connection record");
export const MAX_CONNECTION_BYTES = 64 * 1024;

/** Only trusted storage, configured resource and verified grant IDs may select a location. */
export async function connectionRecordUrl(storage: string, resource: string, grantId: string) {
  const container = connectionsContainer(storage);
  http(resource);
  if (!grantId || grantId.includes("\0")) throw invalid();
  const bytes = new TextEncoder().encode(`mcp-connection\0${resource}\0${grantId}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const name = [...hash]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return new URL(`${name}.ttl`, container).href;
}
function http(value: string) {
  if (!isSafeAbsoluteIri(value)) throw invalid();
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalid();
}
function validate(url: string, dataset: Store): ConnectionRecord {
  http(url);
  // A record is one flat default-graph subject, never a different record or embedded graph.
  if (
    [...dataset].some(
      (q) =>
        q.subject.value !== url ||
        q.subject.termType !== "NamedNode" ||
        q.graph.termType !== "DefaultGraph",
    )
  )
    throw invalid();
  const data = entity.parse(url, dataset);
  if (!data) throw invalid();
  const wrapper = new entity.Wrapper(url, dataset, DataFactory);
  const shape = model.manifest.entities[0] as ManifestEntity;
  // Runtime root parsing drops invalid optional fields. For denial records every present
  // field must validate: ambiguity or malformed revokedAt must never become a live record.
  for (const field of shape.fields) {
    const count = SetFrom.subjectPredicate(
      wrapper,
      field.predicate,
      TermAs.term,
      TermFrom.itself,
    ).size;
    const value = wrapper[field.name as keyof typeof wrapper];
    if (
      (field.maxCount !== undefined && count > field.maxCount) ||
      (count &&
        (value === undefined ||
          (field.collection === "set" && (value as Set<string>).size !== count)))
    )
      throw invalid();
  }
  http(data.resource);
  http(data.client);
  if (data.title !== undefined && [...data.title].length > 256) throw invalid();
  if (data.redirectOrigin !== undefined) {
    http(data.redirectOrigin);
    const redirect = new URL(data.redirectOrigin);
    if (redirect.href !== `${redirect.origin}/`) throw invalid();
  }
  // Retain exact identities: the generated HTTP guards otherwise normalize lexical IRIs.
  for (const key of ["resource", "client", "redirectOrigin"] as const) {
    const field = shape.fields.find((f) => f.name === key);
    {
      const terms = [
        ...SetFrom.subjectPredicate(
          wrapper,
          (field as NonNullable<typeof field>).predicate,
          TermAs.term,
          TermFrom.itself,
        ),
      ];
      if (terms[0]) data[key] = terms[0].value;
    }
  }
  return data;
}
function turtle(dataset: Store) {
  assertWritableQuads([...dataset]);
  const writer = new Writer({ format: "text/turtle" });
  // quadsToString is synchronous; all RDF is emitted by n3.Writer from the generated model.
  const text = writer.quadsToString([...dataset]);
  if (new TextEncoder().encode(text).length > MAX_CONNECTION_BYTES) throw invalid();
  return text;
}
export function buildConnectionRecord(url: string, data: ConnectionRecord): string {
  const dataset = entity.build(url, data);
  const parsed = validate(url, dataset);
  // Refuse dropped optional values too, including invalid dates or enum values supplied at runtime.
  for (const key of Object.keys(data) as (keyof ConnectionRecord)[]) {
    const input = data[key];
    const output = parsed[key];
    if (input === undefined) continue;
    if (input instanceof Date) {
      if (
        !(output instanceof Date) ||
        (key === "lastUsed"
          ? input.toISOString().slice(0, 10) !== output.toISOString().slice(0, 10)
          : input.getTime() !== output.getTime())
      )
        throw invalid();
    } else if (Array.isArray(input)) {
      if (!Array.isArray(output) || input.some((item) => !output.includes(item))) throw invalid();
    } else if (input !== output) throw invalid();
  }
  return turtle(dataset);
}
async function read(text: string, contentType: string, url: string) {
  const dataset = new Store([
    ...(await parseRdf(text, contentType, {
      baseIRI: url,
      maxBytes: MAX_CONNECTION_BYTES,
      maxQuads: 4096,
    })),
  ]);
  return { dataset, data: validate(url, dataset) };
}
export async function parseConnectionRecord(
  text: string,
  contentType: string,
  url: string,
): Promise<ConnectionRecord> {
  return (await read(text, contentType, url)).data;
}
export async function revokeConnectionRecord(
  text: string,
  contentType: string,
  url: string,
  at: Date,
): Promise<string> {
  const timestamp = new Date(at.getTime());
  if (!Number.isFinite(timestamp.getTime())) throw invalid();
  const { dataset, data } = await read(text, contentType, url);
  const wrapper = new entity.Wrapper(url, dataset, DataFactory);
  if (!data.revokedAt || timestamp < data.revokedAt) wrapper.revokedAt = timestamp;
  return turtle(dataset);
}
export async function touchLastUsed(
  text: string,
  contentType: string,
  url: string,
  at: Date,
): Promise<string> {
  const timestamp = new Date(at.getTime());
  if (!Number.isFinite(timestamp.getTime())) throw invalid();
  const { dataset } = await read(text, contentType, url);
  new entity.Wrapper(url, dataset, DataFactory).lastUsed = timestamp;
  return turtle(dataset);
}
/** Only 200 is authoritative. All other non-gone statuses are retryable, never revocations. */
export function classifyConnection(
  status: number,
  record: ConnectionRecord | unknown,
  expected: { resource: string; client: string },
): ConnectionState {
  if (status === 404 || status === 410) return "revoked";
  if (status !== 200) return "unavailable";
  if (
    !record ||
    typeof record !== "object" ||
    !("resource" in record) ||
    !("client" in record) ||
    record.resource !== expected.resource ||
    record.client !== expected.client ||
    ("revokedAt" in record && record.revokedAt !== undefined)
  )
    return "revoked";
  return "live";
}
