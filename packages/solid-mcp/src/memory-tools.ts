// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  type EpistemicStatus,
  type Nanopublication,
  type Nanopublications,
  pkgId,
  purposeFilter,
} from "@jeswr/pkg-memory";
import { safeHttpIri, safeIri, serialize } from "@jeswr/rdf-serialize";
import { buildMemory } from "@jeswr/solid-memory/memory";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { z } from "zod";
import { auditSpecialRead } from "./audit.js";
import {
  assertion,
  type MemoryClientInfo,
  MemoryNode,
  memoryContext,
  values,
} from "./memory-context.js";
import { purposeDenied } from "./personal-policy.js";
import { withPodReadLimits } from "./pod-operation.js";
import type { PodPort } from "./pod-port.js";
import { defineTool, type PodTool, toolText } from "./tool.js";

export type { MemoryClientInfo } from "./memory-context.js";

const SCHEMA = "https://schema.org/";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const PD = "https://w3id.org/dpv/pd#";
const categories = {
  address: "PhysicalAddress",
  email: "EmailAddress",
  phone: "TelephoneNumber",
  preference: "Preference",
  condition: "MedicalHealth",
  allergy: "MedicalHealth",
  medication: "MedicalHealth",
  relationship: "SocialNetwork",
} as const;

const httpIri = z
  .string()
  .refine((value) => safeHttpIri(value) === value, "Expected safe HTTP IRI");
const iri = z.string().refine((value) => safeIri(value) === value, "Expected safe absolute IRI");
const temporal = z.object({
  value: z.string(),
  datatype: z.enum(["date", "dateTime", "gYearMonth", "gYear"]),
});
const period = { validFrom: temporal.optional(), validThrough: temporal.optional() };
const factSchema = z.discriminatedUnion("template", [
  z.object({ template: z.enum(["email", "phone"]), value: z.string() }),
  z.object({
    template: z.literal("address"),
    value: z.object({
      id: iri,
      locality: z.string(),
      country: z.string(),
      street: z.string().optional(),
      postalCode: z.string().optional(),
      home: z.boolean().optional(),
      ...period,
    }),
  }),
  z.object({
    template: z.literal("preference"),
    value: z.object({ propertyID: z.string(), value: z.string() }),
  }),
  z.object({
    template: z.literal("condition"),
    value: z.object({
      id: iri,
      name: z.string(),
      code: z.object({ id: iri, value: z.string(), exactMatch: iri.optional() }).optional(),
      ...period,
    }),
  }),
  z.object({
    template: z.literal("allergy"),
    value: z.object({ id: iri, name: z.string(), ...period }),
  }),
  z.object({
    template: z.literal("medication"),
    value: z.object({
      id: iri,
      medication: z.object({ id: iri, name: z.string(), atcCode: z.string().optional() }),
      dose: z
        .object({ value: z.string(), unit: z.string(), frequency: z.string().optional() })
        .optional(),
      ...period,
    }),
  }),
  z.object({
    template: z.literal("relationship"),
    value: z.object({
      id: iri,
      person: iri,
      roleName: z.string(),
      startDate: temporal.optional(),
      endDate: temporal.optional(),
    }),
  }),
]);

function addClientMetadata(
  value: Nanopublications,
  client: MemoryClientInfo,
  conversationId?: string,
) {
  for (const np of value.nanopubs) {
    const additions = new Store();
    const info = new MemoryNode(np.id, additions, DataFactory);
    if (client.model !== undefined) info.text(`${SCHEMA}instrument`, client.model);
    if (conversationId !== undefined) info.text(`${DCT}isPartOf`, conversationId);
    for (const q of additions)
      value.dataset.addQuad(
        DataFactory.quad(q.subject, q.predicate, q.object, DataFactory.namedNode(np.pubinfoId)),
      );
  }
}

function textOf(value: Nanopublications, np: Nanopublication): string {
  return values(value, np.provenanceId, np.assertionId, `${RDFS}comment`)[0] ?? "";
}
function matchesAbout(graph: DatasetCore, about: string): boolean {
  for (const quad of graph)
    if (
      [quad.subject, quad.object].some(
        (term) => term.termType === "NamedNode" && term.value === about,
      )
    )
      return true;
  return false;
}
function matchesQuery(graph: DatasetCore, text: string, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    text.toLowerCase().includes(needle) ||
    [...graph].some((q) => q.object.value.toLowerCase().includes(needle))
  );
}

/** Compare validated instants without losing the memory model's microseconds. */
function compareDateTimes(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds !== 0) return milliseconds;
  const remainder = (value: string) =>
    Number((/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return remainder(left) - remainder(right);
}

/** Memory tools share the registry's schema validation and independent write guard. */
export function createMemoryTools(
  pod: PodPort,
  readOnly: boolean,
  info?: MemoryClientInfo,
): PodTool[] {
  const clientSnapshot = info && { ...info };
  return [
    defineTool(
      {
        name: "memory_remember",
        aliases: [],
        title: "Remember a fact or note",
        description:
          "Store one private nanopublication. Quoted facts are explicit unless hedged; unquoted facts are inferred; free-text notes are Mentioned. Requires readOnly:false and configured clientInfo.",
        readOnly: false,
        inputSchema: z.object({
          text: z.string().min(1),
          fact: factSchema.optional(),
          quote: z
            .string()
            .min(1)
            .refine((text) => [...text].length <= 300)
            .optional(),
          hedged: z.boolean().optional(),
          about: httpIri.optional(),
          conversationId: z.string().min(1).optional(),
        }),
        async handler({ text, fact, quote, hedged, about, conversationId }) {
          return withPodReadLimits(async () => {
            const { store, output, client } = memoryContext(pod, readOnly, clientSnapshot);
            const batch = crypto.randomUUID();
            const id = pkgId("np", batch, "memory");
            const date = new Date();
            const epistemic: EpistemicStatus = !fact
              ? "Mentioned"
              : hedged
                ? "SelfReportedHedged"
                : quote !== undefined
                  ? "SelfReportedExplicit"
                  : "Inferred";
            const graph = fact
              ? createFactAssertion(about ?? pod.webId, fact)
              : buildMemory(store.url(id), {
                  text,
                  about: about ?? pod.webId,
                  attributedTo: pod.webId,
                  created: date,
                });
            const source = pkgId("mcp", "source", batch);
            const value = await buildNanopublications(
              {
                batch_id: batch,
                worker: { agent_id: client.clientId, agent_label: client.name ?? "MCP client" },
                sources: [{ id: "input", kind: "document", url: source }],
                claims: [
                  {
                    id: "memory",
                    assertion: graph,
                    epistemic,
                    validity: "Current",
                    note: text,
                    attributed_to: pod.webId,
                    categories: fact ? [PD + categories[fact.template]] : [],
                    ...(hedged ? { hedge: "hedged" } : {}),
                    evidence: [
                      {
                        source: "input",
                        timestamp: date.toISOString(),
                        ...(quote === undefined ? {} : { quote }),
                      },
                    ],
                  },
                ],
              },
              { owner: pod.webId, generatedAt: date.toISOString() },
            );
            addClientMetadata(value, client, conversationId);
            await store.writeDefaultPolicy();
            await store.put(value);
            await output.read(store.url(id));
            return toolText(JSON.stringify({ id, epistemic }));
          });
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "memory_recall",
        aliases: [],
        title: "Recall personal memory",
        description:
          "Recall purpose-permitted facts. Defaults to definitely true and Current; include opts into might, mentioned or past. Uncategorized notes fail closed. Requires configured clientInfo and an existing policy.",
        readOnly: true,
        inputSchema: z.object({
          query: z.string().optional(),
          about: httpIri.optional(),
          categories: z.array(iri).optional(),
          purpose: z.enum(["ServiceProvision", "Personalisation"]),
          include: z.array(z.enum(["might", "mentioned", "past"])).optional(),
          limit: z.number().int().min(1).max(100).default(20),
        }),
        async handler({ query, about, categories: requested, purpose, include, limit }) {
          return withPodReadLimits(async () => {
            // Recall never creates policy or storage, even on a writable server.
            const { store, client } = memoryContext(pod, true, clientSnapshot);
            const permits = purposeFilter(
              await store.writeDefaultPolicy(),
              purpose,
              client.clientId,
            );
            const value = await store.list();
            const candidates = classifyNanopublications(value).filter(
              (np) =>
                ((np.belief === "definitely" && np.validity === "Current") ||
                  include?.some((belief) => belief === np.belief)) &&
                (!requested || np.categories.some((category) => requested.includes(category))),
            );
            // Denied contents must never determine matches or denial diagnostics.
            const denied = candidates.filter((np) => !permits(np));
            if (denied.length) {
              return purposeDenied(
                denied.flatMap((np) => (np.categories.length ? np.categories : [""])),
              );
            }
            await auditSpecialRead(
              pod,
              readOnly,
              client.clientId,
              purpose,
              candidates.flatMap((np) => np.categories),
            );
            const selected = candidates.filter(
              (np) =>
                (!about || matchesAbout(assertion(value, np), about)) &&
                (query === undefined ||
                  matchesQuery(assertion(value, np), textOf(value, np), query)),
            );
            selected.sort(
              (a, b) => compareDateTimes(b.generatedAt, a.generatedAt) || a.id.localeCompare(b.id),
            );
            const facts = await Promise.all(
              selected.slice(0, limit).map(async (np) => ({
                id: np.id,
                text: textOf(value, np),
                belief: np.belief,
                epistemic: np.epistemic,
                validity: np.validity,
                ...(np.hedge === undefined ? {} : { hedge: np.hedge }),
                date: np.generatedAt,
                categories: np.categories,
                provenanceId: np.provenanceId,
                assertion: await serialize([...assertion(value, np)], { format: "text/turtle" }),
                provenance: {
                  owner: np.attributedTo,
                  clientId: np.agent,
                  model: values(value, np.pubinfoId, np.id, `${SCHEMA}instrument`)[0],
                  conversationId: values(value, np.pubinfoId, np.id, `${DCT}isPartOf`)[0],
                },
              })),
            );
            return toolText(JSON.stringify({ facts }));
          });
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "memory_forget",
        aliases: [],
        title: "Retract or delete memory",
        description:
          "Retract by appending a revising nanopublication. Delete only this client's nanopublications (including wrapped notes), with a strong ETag. Requires readOnly:false.",
        readOnly: false,
        inputSchema: z.object({ id: z.string(), mode: z.enum(["retract", "delete"]) }),
        async handler({ id, mode }) {
          return withPodReadLimits(async () => {
            const { store, port, reads, output, client } = memoryContext(
              pod,
              readOnly,
              clientSnapshot,
            );
            const original = await store.get(id);
            const np = original.nanopubs[0] as Nanopublication;
            if (mode === "delete") {
              if (np.agent !== client.clientId)
                return {
                  ...toolText("delete denied: memory belongs to another client"),
                  isError: true,
                };
              const url = store.url(id);
              const etag = reads.get(url)?.etag;
              if (!etag || !/^"[^"\r\n]*"$/.test(etag))
                throw new Error("Strong ETag required for deletion");
              await port.delete(url, { ifMatch: etag });
              return toolText(JSON.stringify({ id, mode }));
            }
            const revision = await store.retract(id, {
              batchId: crypto.randomUUID(),
              clientId: client.clientId,
            });
            const replacement = revision.nanopubs[0] as Nanopublication;
            await output.read(store.url(replacement.id));
            return toolText(JSON.stringify({ id: replacement.id, mode }));
          });
        },
      },
      readOnly,
    ),
  ];
}
