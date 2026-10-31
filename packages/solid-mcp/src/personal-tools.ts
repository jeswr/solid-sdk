// AUTHORED-BY Codex GPT-6.1-Sol
import { classifyNanopublications, purposeFilter } from "@jeswr/pkg-memory";
import type { Term } from "@rdfjs/types";
import { Agent } from "@solid/object";
import { DataFactory as df } from "n3";
import { z } from "zod";
import { auditSpecialRead } from "./audit.js";
import { parseBoundedRdf, serializeBoundedTurtle } from "./bounded-rdf.js";
import { assertion, type MemoryClientInfo, MemoryNode, memoryContext } from "./memory-context.js";
import { PD, purposeDenied } from "./personal-policy.js";
import { withPodReadLimits } from "./pod-operation.js";
import type { PodPort } from "./pod-port.js";
import { defineTool, type PodTool, toolText } from "./tool.js";

const VCARD = "http://www.w3.org/2006/vcard/ns#";
const SCHEMA = "https://schema.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const HEALTH = ["https://jeswr.org/ns/sectors/health#", "https://w3id.org/jeswr/sectors/health#"];
const FHIR = "http://hl7.org/fhir/";
const purposeSchema = z.enum(["ServiceProvision", "Personalisation"]);
const instantSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .refine((value) => !value.startsWith("0000") && !/\.\d{7}/.test(value));

function terms(node: MemoryNode, predicate: string): Term[] {
  return [...node.terms(predicate)];
}
function strings(node: MemoryNode, predicate: string): string[] {
  return terms(node, predicate)
    .filter((term) => term.termType === "Literal")
    .map((term) => term.value);
}
function one(node: MemoryNode, predicate: string): string | undefined {
  return strings(node, predicate)[0];
}
function links(node: MemoryNode, predicate: string): Term[] {
  return terms(node, predicate).filter(
    (term) => term.termType === "NamedNode" || term.termType === "BlankNode",
  );
}
function hasLink(node: MemoryNode, predicate: string, value: string): boolean {
  return links(node, predicate).some((term) => term.value === value);
}

/** Calendar bounds have their stated granularity; dateTime retains microseconds. */
function microseconds(value: string): bigint {
  const milliseconds = Date.parse(value);
  const fraction = (/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0");
  // BigInt conversion also rejects a non-finite parse result.
  return BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3, 6));
}
/** @internal Expand a validated or foreign bound without guessing its datatype. */
export function temporalRange(term: Term): [bigint, bigint] {
  if (term.termType !== "Literal" || !term.datatype.value.startsWith(XSD))
    throw new Error("Invalid temporal bound");
  const kind = term.datatype.value.slice(XSD.length);
  const value = term.value;
  if (kind === "dateTime") {
    if (!instantSchema.safeParse(value).success || !value.includes("T"))
      throw new Error("Invalid temporal bound");
    const point = microseconds(value);
    return [point, point];
  }
  const pattern = { gYear: /^\d{4}$/, gYearMonth: /^\d{4}-\d{2}$/, date: /^\d{4}-\d{2}-\d{2}$/ };
  if (!Object.hasOwn(pattern, kind) || !pattern[kind as keyof typeof pattern].test(value))
    throw new Error("Invalid temporal bound");
  const date = kind === "gYear" ? `${value}-01-01` : kind === "gYearMonth" ? `${value}-01` : value;
  if (!instantSchema.safeParse(date).success) throw new Error("Invalid temporal bound");
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start);
  if (kind === "gYear") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (kind === "gYearMonth") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 1);
  return [BigInt(start.getTime()) * 1000n, BigInt(end.getTime()) * 1000n - 1n];
}
function activeAt(node: MemoryNode, at: bigint): boolean {
  const from = terms(node, `${SCHEMA}validFrom`);
  const through = terms(node, `${SCHEMA}validThrough`);
  if (from.length > 1 || through.length > 1) throw new Error("Ambiguous temporal bounds");
  const lower = from[0] && temporalRange(from[0])[0];
  const upper = through[0] && temporalRange(through[0])[1];
  if (lower !== undefined && upper !== undefined && lower > upper)
    throw new Error("Invalid temporal bounds");
  return (lower === undefined || lower <= at) && (upper === undefined || at <= upper);
}

/** Purpose decisions and projections are recreated for every invocation. */
export function createPersonalTools(
  pod: PodPort,
  readOnly: boolean,
  info?: MemoryClientInfo,
): PodTool[] {
  const client = info && { ...info };
  async function context(purpose: z.infer<typeof purposeSchema>) {
    // The read-only port makes a missing policy an error, never an implicit grant.
    const ctx = memoryContext(pod, true, client);
    const permits = purposeFilter(
      await ctx.store.writeDefaultPolicy(),
      purpose,
      ctx.client.clientId,
    );
    return { ...ctx, permits };
  }
  return [
    defineTool(
      {
        name: "profile_get",
        aliases: [],
        title: "Get profile contacts",
        readOnly: true,
        description:
          "Read the owner's in-pod WebID name, emails and phones under pd:Contact policy. Requires purpose and configured clientInfo.",
        inputSchema: z.object({ purpose: purposeSchema }),
        async handler({ purpose }) {
          return withPodReadLimits(async () => {
            const { output, permits } = await context(purpose);
            if (!permits({ categories: [`${PD}Contact`] })) return purposeDenied([`${PD}Contact`]);
            const read = await output.read(pod.webId, { accept: "text/turtle" });
            const graph = await output.rdf(
              pod.webId,
              read,
              await parseBoundedRdf(
                new TextDecoder("utf-8", { fatal: true }).decode(read.body),
                read.contentType,
                pod.webId,
              ),
            );
            const agent = new Agent(pod.webId, graph, df);
            const owner = new MemoryNode(pod.webId, graph, df);
            function contacts(predicate: string, scheme: string): string[] {
              const values = links(owner, predicate).flatMap((term) => {
                if (term.termType === "NamedNode" && term.value.startsWith(scheme))
                  return [term.value.slice(scheme.length)];
                return links(new MemoryNode(term, graph, df), `${VCARD}hasValue`)
                  .filter(
                    (value) => value.termType === "NamedNode" && value.value.startsWith(scheme),
                  )
                  .map((value) => value.value.slice(scheme.length));
              });
              return [...new Set(values)].sort();
            }
            return toolText(
              JSON.stringify({
                name:
                  (terms(owner, `${VCARD}fn`)[0]?.termType === "Literal"
                    ? agent.vcardFn
                    : undefined) ??
                  (terms(owner, "http://xmlns.com/foaf/0.1/name")[0]?.termType === "Literal"
                    ? agent.foafName
                    : undefined) ??
                  null,
                emails: contacts(`${VCARD}hasEmail`, "mailto:"),
                phones: contacts(`${VCARD}hasTelephone`, "tel:"),
              }),
            );
          });
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "address_get",
        aliases: [],
        title: "Get addresses",
        readOnly: true,
        description:
          "Read definitely-true Current owner addresses, at now or an ISO date/instant. Calendar validity bounds are inclusive. Requires purpose and configured clientInfo.",
        inputSchema: z.object({ purpose: purposeSchema, at: instantSchema.optional() }),
        async handler({ purpose, at }) {
          return withPodReadLimits(async () => {
            const { store, permits, client } = await context(purpose);
            if (!permits({ categories: [`${PD}PhysicalAddress`] }))
              return purposeDenied([`${PD}PhysicalAddress`]);
            const value = await store.list();
            const candidates = classifyNanopublications(value).filter(
              (np) =>
                np.belief === "definitely" &&
                np.validity === "Current" &&
                np.categories.includes(`${PD}PhysicalAddress`),
            );
            const denied = candidates.filter((np) => !permits(np));
            if (denied.length) return purposeDenied(denied.flatMap((np) => np.categories));
            const point = microseconds(at ?? new Date().toISOString());
            const addresses = candidates.flatMap((np) => {
              const graph = assertion(value, np);
              return links(new MemoryNode(pod.webId, graph, df), `${VCARD}hasAddress`).flatMap(
                (term) => {
                  const node = new MemoryNode(term, graph, df);
                  if (!hasLink(node, RDF_TYPE, `${VCARD}Address`) || !activeAt(node, point))
                    return [];
                  return [
                    {
                      id: term.value,
                      locality: one(node, `${VCARD}locality`),
                      country: one(node, `${VCARD}country-name`),
                      street: one(node, `${VCARD}street-address`),
                      postalCode: one(node, `${VCARD}postal-code`),
                      validFrom: one(node, `${SCHEMA}validFrom`),
                      validThrough: one(node, `${SCHEMA}validThrough`),
                      provenanceId: np.provenanceId,
                    },
                  ];
                },
              );
            });
            await auditSpecialRead(
              pod,
              readOnly,
              client.clientId,
              purpose,
              candidates.flatMap((np) => np.categories),
            );
            addresses.sort(
              (a, b) => a.id.localeCompare(b.id) || a.provenanceId.localeCompare(b.provenanceId),
            );
            return toolText(JSON.stringify({ addresses }));
          });
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "health_query",
        aliases: [],
        title: "Query health facts",
        readOnly: true,
        description:
          "Read definitely-true Current owner health facts only with an explicit purpose permit. Requires a successful private audit write and readOnly:false.",
        inputSchema: z.object({
          kind: z.enum(["conditions", "allergies", "medications", "observations"]),
          purpose: purposeSchema,
        }),
        async handler({ kind, purpose }) {
          return withPodReadLimits(async () => {
            const { store, permits, client } = await context(purpose);
            const category = `${PD}MedicalHealth`;
            if (!permits({ categories: [category] })) return purposeDenied([category]);
            const value = await store.list();
            const candidates = classifyNanopublications(value).filter(
              (np) =>
                np.belief === "definitely" &&
                np.validity === "Current" &&
                np.categories.includes(category),
            );
            const denied = candidates.filter((np) => !permits(np));
            if (denied.length) return purposeDenied(denied.flatMap((np) => np.categories));
            const types = {
              conditions: [...HEALTH.map((ns) => `${ns}Condition`), `${SCHEMA}MedicalCondition`],
              allergies: [`${FHIR}AllergyIntolerance`],
              medications: HEALTH.map((ns) => `${ns}MedicationStatement`),
              observations: [
                ...HEALTH.map((ns) => `${ns}Observation`),
                `${FHIR}Observation`,
                `${SCHEMA}Observation`,
              ],
            }[kind];
            const facts = candidates.flatMap((np) => {
              const graph = assertion(value, np);
              const matches = [...graph.getSubjects(df.namedNode(RDF_TYPE), null, null)].some(
                (subject) => {
                  const node = new MemoryNode(subject, graph, df);
                  return (
                    types.some((type) => hasLink(node, RDF_TYPE, type)) &&
                    [
                      ...HEALTH.map((ns) => `${ns}patient`),
                      `${FHIR}subject`,
                      `${SCHEMA}subject`,
                    ].some((predicate) => hasLink(node, predicate, pod.webId))
                  );
                },
              );
              return matches
                ? [
                    {
                      id: np.id,
                      provenanceId: np.provenanceId,
                      assertion: serializeBoundedTurtle(graph),
                    },
                  ]
                : [];
            });
            // Audit even an empty authorized query, so query shape cannot bypass auditing.
            await auditSpecialRead(pod, readOnly, client.clientId, purpose, [
              category,
              ...candidates.flatMap((np) => np.categories),
            ]);
            facts.sort((a, b) => a.id.localeCompare(b.id));
            return toolText(JSON.stringify({ kind, facts }));
          });
        },
      },
      readOnly,
    ),
  ];
}
