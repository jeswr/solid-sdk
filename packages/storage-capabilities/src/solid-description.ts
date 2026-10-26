// AUTHORED-BY GPT-6.1-Sol
import type { DatasetCore, Term } from "@rdfjs/types";
import { DatasetWrapper, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import type { CapabilityEntry, ServiceEntry, StorageDescription } from "./types.js";
import { ACQ, DCT, DID, LWS, NOTIFY, SSD } from "./vocab.js";

const SSD_FORMAT = "https://jeswr.org/ns/solid-sd#format";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
// These extra fields supply IRI-valued feature evidence. Validate before the generic
// extra mapper turns literal lexical values into strings indistinguishable from IRIs.
const IRI_EVIDENCE: ReadonlySet<string> = new Set([
  DCT.conformsTo,
  SSD.model,
  "https://www.w3.org/ns/lws#model",
  "https://jeswr.org/ns/solid-sd#subscriptionType",
  LWS.subscriptionType,
  "https://jeswr.org/ns/solid-sd#appliesTo",
  LWS.appliesTo,
]);
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
    return Object.fromEntries(
      [...predicates].map((predicate) => {
        const objects = this.objects(predicate);
        const terms = IRI_EVIDENCE.has(predicate) ? objects.filter(isNamedNode) : objects;
        const values = terms.map((term): unknown => {
          // ADR-008 format nodes may be named (`ssd:format <#turtle>`): expand those too, so
          // their ssd:source/ssd:patchType survive. Other named objects stay IRI strings.
          // Nodes already expanded anywhere in this mapping become references (checked first,
          // so a shared node costs one expansion and no repeated dataset lookups).
          const blank = term.termType === "BlankNode";
          const named = predicate === SSD_FORMAT && term.termType === "NamedNode";
          if (!blank && !named) return term.value;
          const id = blank ? `_:${term.value}` : term.value;
          if (visited.has(term.value) || depth >= 31) return { "@id": id };
          if (named && this.dataset.match(term as Term).size === 0) return term.value;
          // Only nested expansions are recorded: entry roots stay expandable where nested, so a
          // reference always has a definition inside some service or capability extra.
          visited.add(term.value);
          // Keep the definition identifiable so later references can resolve to it.
          return {
            "@id": id,
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

function notificationExtra(node: DescriptionNode, visited: Set<string>): Record<string, unknown> {
  const normative = node.objects(NOTIFY.channelType);
  const normativePresent = normative.length > 0;
  // Read-only fallback for sparq's pre-draft property (sparq-org/sparq#7234).
  // The draft's notify:channelType takes precedence whenever present.
  const rawChannels = normativePresent
    ? normative
    : node.objects("https://jeswr.org/ns/solid-sd#channelType");
  const channel = rawChannels[0];
  // SSD-SVC-NOTIFY-2: exactly one raw object, and it must be an IRI. Filtering
  // first would accept an IRI plus a literal, or enable multiple channels.
  const channels =
    rawChannels.length === 1 && channel?.termType === "NamedNode" ? [channel.value] : [];
  return {
    ...node.extra(
      [RDF_TYPE, DID.serviceEndpoint, DCT.conformsTo, NOTIFY.channelType, NOTIFY.feature],
      visited,
    ),
    // Empty arrays block all downstream channel fallbacks, including service types.
    [NOTIFY.channelType]: channels.length === 1 ? channels[0] : channels,
    [NOTIFY.feature]: node.iris(NOTIFY.feature),
  };
}

function channelTypes(extra: ServiceEntry["extra"]): string[] {
  const value = extra[NOTIFY.channelType];
  return (Array.isArray(value) ? value : [value]).filter((type) => CHANNEL_TYPES.has(type));
}

function notificationKey(endpoint: string, extra: ServiceEntry["extra"]): string | undefined {
  const channel = extra[NOTIFY.channelType];
  return typeof channel === "string" ? JSON.stringify([endpoint, channel]) : undefined;
}

/** Accumulate only incoming metadata; materialize each merged service once. */
class ServiceBuilder {
  type = new Set<string>();
  private profiles = new Set<string>();
  private readonly features = new Set<string>();
  private readonly extras = new Map<string, unknown>();
  private readonly nodes = new Map<string, Record<string, unknown>>();
  private id: string | undefined;
  readonly endpoint: string;

  constructor(
    entry: ServiceEntry,
    private readonly notification = false,
  ) {
    this.endpoint = entry.endpoint;
    this.add(entry);
  }

  add(entry: ServiceEntry): void {
    if (entry.id !== undefined) this.id = entry.id;
    for (const type of entry.type) this.type.add(type);
    for (const profile of entry.conformsTo ?? []) this.profiles.add(profile);
    for (const [predicate, value] of Object.entries(entry.extra)) {
      if (this.notification && predicate === NOTIFY.feature) {
        for (const feature of value as string[]) this.features.add(feature);
      } else {
        this.extras.set(
          predicate,
          Array.isArray(value)
            ? value.map((item) => this.retainDefinition(item))
            : this.retainDefinition(value),
        );
      }
    }
  }

  private retainDefinition(value: unknown): unknown {
    // Mapper values are strings or node objects (arrays are handled by add).
    if (typeof value === "string") return value;
    const node = value as Record<string, unknown>;
    const id = node["@id"] as string;
    if (Object.keys(node).length > 1) this.nodes.set(id, node);
    // A later reference must not erase the sole expansion, including in repeated extras.
    return this.nodes.get(id) ?? node;
  }

  addAcq(): void {
    // ACQ metadata precedes listed metadata; this runs once per distinct endpoint.
    this.type = new Set([SSD.SparqlQueryService, ...this.type]);
    this.profiles = new Set([ACQ.profile, ...this.profiles]);
  }

  build(): ServiceEntry {
    const extra = Object.fromEntries(this.extras);
    if (this.notification) extra[NOTIFY.feature] = [...this.features];
    return {
      type: [...this.type],
      endpoint: this.endpoint,
      ...(this.id !== undefined ? { id: this.id } : {}),
      ...(this.profiles.size > 0 ? { conformsTo: [...this.profiles] } : {}),
      extra,
    };
  }
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
  // One expansion per node across the whole mapping; deriveFeatures resolves `{ "@id" }` refs.
  const visited = new Set<string>();
  const services: ServiceBuilder[] = [];
  const notificationServices = new Map<string, ServiceBuilder>();
  const subscriptions = new DescriptionDataset(dataset, DataFactory).subscriptions;
  const subscriptionExtras = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const subscription of subscriptions) {
    if (subscription.termType !== "NamedNode" || seen.has(subscription.value)) continue;
    seen.add(subscription.value);
    const extra = notificationExtra(subscription, visited);
    subscriptionExtras.set(subscription.value, extra);
    const key = notificationKey(subscription.value, extra);
    const builder = new ServiceBuilder(
      {
        // Only recognised channel types become service types; others stay in `extra` so a
        // description cannot pose as another service class through notify:channelType.
        type: [SSD.SolidNotificationService, ...channelTypes(extra)],
        endpoint: subscription.value,
        extra,
      },
      true,
    );
    if (key !== undefined) notificationServices.set(key, builder);
    services.push(builder);
  }
  if (notificationsOnly)
    return { services: services.map((service) => service.build()), capabilities: [] };
  for (const service of root.nodes(DID.service)) {
    const endpoint = service.iris(DID.serviceEndpoint)[0];
    if (endpoint === undefined) continue;
    const conformsTo = service.iris(DCT.conformsTo);
    const types = service.types;
    const notification = types.includes(SSD.SolidNotificationService);
    const extra = notification
      ? (subscriptionExtras.get(service.value) ?? notificationExtra(service, visited))
      : service.extra([RDF_TYPE, DID.serviceEndpoint, DCT.conformsTo], visited);
    const entry: ServiceEntry = {
      type: [...types, ...(notification ? channelTypes(extra) : [])],
      endpoint,
      ...service.identity,
      ...(conformsTo.length > 0 ? { conformsTo } : {}),
      extra,
    };
    // SSD-CLI-6: match both endpoint and channel, including unknown channel IRIs.
    const key = notification ? notificationKey(endpoint, extra) : undefined;
    const duplicate = key === undefined ? undefined : notificationServices.get(key);
    if (duplicate === undefined) {
      const builder = new ServiceBuilder(entry, notification);
      if (key !== undefined) notificationServices.set(key, builder);
      services.push(builder);
    } else {
      duplicate.add(entry);
    }
  }
  // Preserve first-listed query-service precedence without scanning per ACQ endpoint.
  const queryServices = new Map<string, ServiceBuilder>();
  for (const service of services) {
    if (service.type.has(SSD.SparqlQueryService) && !queryServices.has(service.endpoint)) {
      queryServices.set(service.endpoint, service);
    }
  }
  for (const endpoint of root.iris(ACQ.endpoint)) {
    // SSD-CLI-7: the root ACQ predicate supplies the query profile too.
    const acq: ServiceEntry = {
      type: [SSD.SparqlQueryService],
      endpoint,
      conformsTo: [ACQ.profile],
      extra: {},
    };
    const duplicate = queryServices.get(endpoint);
    if (duplicate === undefined) services.push(new ServiceBuilder(acq));
    else duplicate.addAcq();
  }
  const capabilities: CapabilityEntry[] = root.nodes(LWS.capability).map((capability) => ({
    type: capability.types,
    ...capability.identity,
    extra: capability.extra([RDF_TYPE], visited),
  }));
  return { services: services.map((service) => service.build()), capabilities };
}
