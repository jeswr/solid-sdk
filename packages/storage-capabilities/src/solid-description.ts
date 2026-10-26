// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore, Term } from "@rdfjs/types";
import { DatasetWrapper, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import type { CapabilityEntry, ServiceEntry, StorageDescription } from "./types.js";
import { ACQ, DCT, DID, LWS, NOTIFY, SSD } from "./vocab.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const CHANNEL_TYPES: ReadonlySet<string> = new Set([
  NOTIFY.WebSocketChannel2023,
  NOTIFY.StreamingHTTPChannel2023,
  NOTIFY.WebhookChannel2023,
  NOTIFY.LDNChannel2023,
  NOTIFY.WebPushChannel2023,
]);

/** Small RDF view shared by subscription, service, and capability nodes. */
class DescriptionNode extends TermWrapper {
  objects(predicate: string): Term[] {
    return [...SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself)];
  }

  iris(predicate: string): string[] {
    return [
      ...new Set(
        this.objects(predicate)
          .filter(isNamedNode)
          .map((term) => term.value),
      ),
    ];
  }

  nodes(predicate: string): DescriptionNode[] {
    return this.objects(predicate)
      .filter((term) => term.termType === "NamedNode" || term.termType === "BlankNode")
      .map((term) => new DescriptionNode(term, this.dataset, this.factory));
  }

  get types(): string[] {
    return this.iris(RDF_TYPE);
  }

  get identity(): { id?: string } {
    return this.termType === "NamedNode" ? { id: this.value } : {};
  }

  /** Expanded predicate keys; scalar singleton values and arrays for repeated values. */
  extra(
    excluded: readonly string[] = [],
    visited = new Set<string>(),
    depth = 0,
  ): Record<string, unknown> {
    const predicates = new Set<string>();
    for (const quad of this.dataset.match(this as unknown as Term)) {
      if (!excluded.includes(quad.predicate.value)) predicates.add(quad.predicate.value);
    }
    visited.add(this.value);
    return Object.fromEntries(
      [...predicates].map((predicate) => {
        const values = this.objects(predicate).map((term): unknown => {
          if (term.termType !== "BlankNode") return term.value;
          // Expand each blank node once, bounding both depth and shared-subgraph growth.
          if (visited.has(term.value) || depth >= 31) return { "@id": `_:${term.value}` };
          // Keep the definition identifiable so later references can resolve to it.
          return {
            "@id": `_:${term.value}`,
            ...new DescriptionNode(term, this.dataset, this.factory).extra([], visited, depth + 1),
          };
        });
        return [predicate, values.length === 1 ? values[0] : values];
      }),
    );
  }
}

class DescriptionDataset extends DatasetWrapper {
  get subscriptions(): Iterable<DescriptionNode> {
    return this.objectsOf(NOTIFY.subscription, DescriptionNode);
  }
}

function isNamedNode(term: Term): boolean {
  return term.termType === "NamedNode";
}

/**
 * Map an already parsed Solid description (ADR-002 step 5c).
 * Parse bytes with `@jeswr/fetch-rdf`'s `parseRdf`, using the description URL as baseIRI.
 * HTTP metadata, origin checks, and construction of the complete StorageDescription belong
 * to the resolver. This mapper never fetches or mutates the supplied RDF/JS dataset.
 */
export function parseSolidDescription(
  dataset: DatasetCore,
  rootUrl: string,
  notificationsOnly = false,
): Pick<StorageDescription, "services" | "capabilities"> {
  const root = new DescriptionNode(rootUrl, dataset, DataFactory);
  const services: ServiceEntry[] = [];
  const subscriptions = new DescriptionDataset(dataset, DataFactory).subscriptions;
  const seen = new Set<string>();
  for (const subscription of subscriptions) {
    if (subscription.termType !== "NamedNode" || seen.has(subscription.value)) continue;
    seen.add(subscription.value);
    const channels = subscription.iris(NOTIFY.channelType);
    services.push({
      // Only recognised channel types become service types; others stay in `extra` so a
      // description cannot pose as another service class through notify:channelType.
      type: [SSD.SolidNotificationService, ...channels.filter((type) => CHANNEL_TYPES.has(type))],
      endpoint: subscription.value,
      extra: {
        ...subscription.extra([RDF_TYPE, NOTIFY.channelType, NOTIFY.feature]),
        ...(channels.length > 0
          ? { [NOTIFY.channelType]: channels.length === 1 ? channels[0] : channels }
          : {}),
        [NOTIFY.feature]: subscription.iris(NOTIFY.feature),
      },
    });
  }
  if (notificationsOnly) return { services, capabilities: [] };
  for (const service of root.nodes(DID.service)) {
    const endpoint = service.iris(DID.serviceEndpoint)[0];
    if (endpoint === undefined) continue;
    const conformsTo = service.iris(DCT.conformsTo);
    services.push({
      type: service.types,
      endpoint,
      ...service.identity,
      ...(conformsTo.length > 0 ? { conformsTo } : {}),
      extra: service.extra([RDF_TYPE, DID.serviceEndpoint, DCT.conformsTo]),
    });
  }
  for (const endpoint of root.iris(ACQ.endpoint)) {
    services.push({ type: [SSD.SparqlQueryService], endpoint, extra: {} });
  }
  const capabilities: CapabilityEntry[] = root.nodes(LWS.capability).map((capability) => ({
    type: capability.types,
    ...capability.identity,
    extra: capability.extra([RDF_TYPE]),
  }));
  return { services, capabilities };
}
