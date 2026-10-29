// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-6.1-Sol
import type {
  CapabilityEntry,
  Feature,
  Features,
  ProbeResult,
  ServiceEntry,
  StorageDescription,
} from "./types.js";
import { ACQ, DCT, LWS, NOTIFY, SSD } from "./vocab.js";

const SSD_NS = "https://jeswr.org/ns/solid-sd#";
const Y_PROTOCOL_V1 = `${SSD_NS}y-protocol-v1`;
const SSD_ACCESS_REQUEST = `${SSD_NS}AccessRequestService`;
const SSD_ACCESS_GRANT = `${SSD_NS}AccessGrantService`;
const RDF_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "text/turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "text/n3",
  // ADR-002 asks whether an RDF source is listed, independent of what the SDK can parse.
  "application/rdf+xml",
]);
const SOLID_RDF_FORMATS = ["text/turtle", "application/ld+json"] as const;
/** RFC 6838 type/subtype (no parameters); also rules out "__proto__"-style keys. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const ACCESS_MODELS: Readonly<Record<string, "acp" | "wac" | "odrl-grants">> = {
  [`${SSD_NS}ACP`]: "acp",
  [`${SSD_NS}WAC`]: "wac",
  [`${SSD_NS}ODRLGrants`]: "odrl-grants",
};
const JSON_PATCH = "application/json-patch+json";
const CHANNEL_ORDER = ["websocket", "sse", "webhook", "legacy-ws"] as const;
type Channel = (typeof CHANNEL_ORDER)[number];

/** Local name of an IRI or compact term: the part after the last `#`, `/` or `:`. */
function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"), iri.lastIndexOf(":")) + 1);
}

const LWS_NS = "https://www.w3.org/ns/lws#";
const NOTIFY_NS = "http://www.w3.org/ns/solid/notifications#";

/**
 * Values of an extra member under its documented keys only: the raw JSON key, the `ssd:`
 * compact key, and the expanded ssd:/lws: IRIs (plus notify:channelType for channelType).
 * Unrelated predicates that merely share a local name are ignored.
 */
function values(extra: Readonly<Record<string, unknown>>, name: string): unknown[] {
  const keys = new Set([name, `ssd:${name}`, `${SSD_NS}${name}`, `${LWS_NS}${name}`]);
  if (name === "channelType") keys.add(`${NOTIFY_NS}channelType`);
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (!keys.has(key)) continue;
    // Iterative append: a spread of a huge parser-accepted array would overflow the stack.
    if (Array.isArray(value)) for (const item of value) found.push(item);
    else found.push(value);
  }
  return found;
}

function origin(url: unknown): string | undefined {
  try {
    return new URL(url as string).origin;
  } catch {
    return undefined;
  }
}

function strings(extra: Readonly<Record<string, unknown>>, name: string): string[] {
  return values(extra, name).filter((value): value is string => typeof value === "string");
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function feature<T>(state: Feature<T>["state"], evidence: string, detail: T): Feature<T> {
  return { state, evidence, detail };
}

/**
 * Derive ADR-002's feature flags from a resolved description and an optional Solid probe.
 * Pure and deterministic: no I/O, no clock, unknown service/capability types are ignored.
 * Evidence strings are `<source>:<type-local-name>[:<endpoint>]` or `header:<Header-Name>`.
 */
export function deriveFeatures(d: StorageDescription, probe?: ProbeResult): Features {
  const services: readonly ServiceEntry[] = Array.isArray(d.services) ? d.services : [];
  const capabilities: readonly CapabilityEntry[] = Array.isArray(d.capabilities)
    ? d.capabilities
    : [];
  const source = d.sources?.[0] ?? "probe";
  const lws = d.protocol === "lws";
  /** A description document was read (not only headers). */
  const described = d.descriptionUrl !== null && source !== "probe";
  /** Root entries need a verified root; also distrust legacy cached foreign descriptions. */
  const authoritative =
    described &&
    !(d.evidence ?? []).some((evidence) =>
      ["cross-origin-description", "assumed-origin-root"].includes(evidence),
    );
  const typed = (entry: { type?: readonly string[] }, ...iris: string[]) =>
    Array.isArray(entry.type) && entry.type.some((type) => iris.includes(type));
  // ADR-008 §8: endpoints must share the storage's origin. Only Solid notification
  // subscription services (e.g. ESS) are a documented cross-origin exception.
  const rootOrigin = origin(d.root);
  const local = (entry: ServiceEntry) =>
    rootOrigin !== undefined && origin(entry.endpoint) === rootOrigin;
  const service = (...iris: string[]) =>
    services.find((entry) => typed(entry, ...iris) && local(entry));
  const capabilitiesNamed = (name: string) =>
    capabilities.filter((entry) => typed(entry, `${SSD_NS}${name}`));
  const cite = (type: string, endpoint?: string) =>
    `${source}:${localName(type)}${endpoint === undefined ? "" : `:${endpoint}`}`;
  const absent = (type: string) => `${source}:absent:${localName(type)}`;
  /** For rows whose only negative evidence is "the description does not list it". */
  const missing = <T>(type: string, detail: T): Feature<T> =>
    feature("unknown", authoritative ? absent(type) : "none", detail);
  // SSD-CLI-5/20: at least one implemented profile is enough. No new public option is
  // needed: these are the query, sync and access profiles implemented by the suite.
  const profiledService = (profile: string, ...iris: string[]) =>
    services.find(
      (entry) =>
        typed(entry, ...iris) &&
        local(entry) &&
        Array.isArray(entry.conformsTo) &&
        entry.conformsTo.includes(profile),
    );

  // liveUpdates
  const channels = new Map<Channel, { endpoint: string; evidence: string }>();
  const offer = (channel: Channel, entry: ServiceEntry, type: string) => {
    if (!channels.has(channel)) {
      channels.set(channel, { endpoint: entry.endpoint, evidence: cite(type, entry.endpoint) });
    }
  };
  let notificationServices = 0;
  for (const entry of services) {
    if (typed(entry, SSD.SolidNotificationService)) {
      notificationServices++;
      // Parsers normalise notify:channelType, with sparq's ssd:channelType retained as a
      // read-only fallback. Legacy-ws comes only from the resolver's Updates-Via mapping.
      const extra = entry.extra ?? {};
      const normative = extra[NOTIFY.channelType] ?? extra.channelType;
      const kinds =
        normative === undefined
          ? [...entry.type, ...strings(extra, "channelType")]
          : Array.isArray(normative)
            ? normative
            : [normative];
      if (!described && entry.type.includes(SSD.LegacyUpdatesVia)) {
        offer("legacy-ws", entry, SSD.LegacyUpdatesVia);
      }
      if (kinds.includes(NOTIFY.WebSocketChannel2023)) {
        offer("websocket", entry, NOTIFY.WebSocketChannel2023);
      }
      if (kinds.includes(NOTIFY.StreamingHTTPChannel2023)) {
        offer("sse", entry, NOTIFY.StreamingHTTPChannel2023);
      }
      if (kinds.includes(SSD.StreamingHttpChannel)) offer("sse", entry, SSD.StreamingHttpChannel);
    }
    // Evaluated independently: a service may carry both notification types.
    if (authoritative && typed(entry, LWS.NotificationService) && local(entry)) {
      notificationServices++;
      const kinds = strings(entry.extra ?? {}, "subscriptionType");
      if (kinds.includes(SSD.WebSocketSubscription)) {
        offer("websocket", entry, SSD.WebSocketSubscription);
      }
      if (kinds.includes(SSD.SseSubscription)) offer("sse", entry, SSD.SseSubscription);
      if (kinds.includes(LWS.WebhookSubscription)) {
        offer("webhook", entry, LWS.WebhookSubscription);
      }
    }
  }
  const offered = CHANNEL_ORDER.filter((channel) => channels.has(channel));
  const best = offered[0] === undefined ? undefined : channels.get(offered[0]);
  const liveUpdates = best
    ? feature("available", best.evidence, { channels: offered, endpoint: best.endpoint })
    : notificationServices > 0
      ? feature("unavailable", `${source}:unsupported-channels`, { channels: [] })
      : missing(SSD.SolidNotificationService, { channels: [] });

  // realtimeCollab
  const crdt = authoritative ? profiledService(Y_PROTOCOL_V1, SSD.CrdtSyncService) : undefined;
  const realtimeCollab = crdt
    ? feature("available", cite(SSD.CrdtSyncService, crdt.endpoint), {
        endpoint: crdt.endpoint,
        // The find above only matches entries whose conformsTo is an array.
        protocols: [...(crdt.conformsTo as readonly string[])],
      })
    : missing(SSD.CrdtSyncService, { protocols: [] as string[] });

  // serverSearch
  const sparql = authoritative ? profiledService(ACQ.profile, SSD.SparqlQueryService) : undefined;
  const serverSearch = sparql
    ? feature("available", cite(SSD.SparqlQueryService, sparql.endpoint), {
        endpoint: sparql.endpoint,
      })
    : missing(SSD.SparqlQueryService, {});

  // typeIndex
  const typeIndexService = authoritative ? service(LWS.TypeIndexService) : undefined;
  const typeSearchService = authoritative ? service(LWS.TypeSearchService) : undefined;
  const typeEndpoints = {
    ...(typeIndexService ? { indexEndpoint: typeIndexService.endpoint } : {}),
    ...(typeSearchService ? { searchEndpoint: typeSearchService.endpoint } : {}),
  };
  const typeIndex = !lws
    ? feature("available", `${source}:client-type-index`, { mode: "client" as const })
    : typeIndexService && typeSearchService
      ? feature("available", cite(LWS.TypeIndexService, typeIndexService.endpoint), {
          mode: "server" as const,
          ...typeEndpoints,
        })
      : missing(typeIndexService ? LWS.TypeSearchService : LWS.TypeIndexService, {
          mode: "server" as const,
          ...typeEndpoints,
        });

  // accessRequests / accessGrants
  const access = (lwsType: string, ssdType: string) => {
    // LWS types are normative on both protocols. Retain the old SSD aliases as reads.
    const entry = authoritative ? profiledService(LWS.AccessProfile, lwsType, ssdType) : undefined;
    return entry
      ? feature(
          "available",
          cite(entry.type.includes(lwsType) ? lwsType : ssdType, entry.endpoint),
          {
            endpoint: entry.endpoint,
            profiles: [...(entry.conformsTo as readonly string[])],
          },
        )
      : missing(lws ? lwsType : ssdType, { profiles: [] as string[] });
  };
  const accessRequests = access(LWS.AccessRequestService, SSD_ACCESS_REQUEST);
  const accessGrants = access(LWS.AccessGrantService, SSD_ACCESS_GRANT);

  // accessControl
  let accessControl: Features["accessControl"];
  if (lws) {
    accessControl =
      accessGrants.state === "available"
        ? feature("available", accessGrants.evidence, { model: "odrl-grants" })
        : feature(accessGrants.state, accessGrants.evidence, { model: "none" });
  } else {
    // Union over every AccessControl capability, so an unrecognised one cannot hide another.
    const declared = authoritative
      ? capabilities.filter((entry) => typed(entry, SSD.AccessControl))
      : [];
    const models = new Set(
      declared.flatMap((entry) =>
        strings(entry.extra ?? {}, "model").map((iri) => ACCESS_MODELS[iri]),
      ),
    );
    const model = models.has("acp")
      ? "acp"
      : models.has("wac")
        ? "wac"
        : models.has("odrl-grants")
          ? "odrl-grants"
          : undefined;
    if (model) {
      accessControl = feature("available", cite(SSD.AccessControl), { model });
    } else if (probe?.acpLink !== undefined) {
      accessControl = feature("available", "header:Link", { model: "acp" });
    } else if (probe?.aclLink !== undefined) {
      accessControl = feature("available", "header:Link", { model: "wac" });
    } else if (probe?.wacAllow !== undefined) {
      accessControl = feature("available", "header:WAC-Allow", { model: "wac" });
    } else {
      accessControl = feature("unknown", probe ? "header:none" : "none", { model: "none" });
    }
  }

  // versioning / trash
  const serviceRow = (type: string) => {
    const entry = authoritative ? service(type) : undefined;
    return entry
      ? feature("available", cite(type, entry.endpoint), { endpoint: entry.endpoint })
      : missing(type, {});
  };
  const versioning = serviceRow(SSD.VersioningService);
  const trash = serviceRow(SSD.TrashService);

  // move
  let move: Features["move"];
  if (lws) {
    const declared = authoritative
      ? capabilities.find((entry) => typed(entry, LWS.MoveResource))
      : undefined;
    if (declared) {
      const extra = declared.extra ?? {};
      const preserves = values(extra, "preservesIdentifier")[0];
      move = feature("available", cite(LWS.MoveResource), {
        native: true,
        containers: strings(extra, "appliesTo").some((target) => localName(target) === "Container"),
        preservesIdentifier:
          preserves === true || preserves === "true"
            ? true
            : preserves === false || preserves === "false"
              ? false
              : null,
      });
    } else {
      move = missing(LWS.MoveResource, {
        native: false,
        containers: false,
        preservesIdentifier: null,
      });
    }
  } else {
    move = feature("available", "emulated", {
      native: false,
      containers: true,
      preservesIdentifier: false,
    });
  }

  // patch
  // Union over every PatchSupport capability.
  const patchCapabilities = authoritative ? capabilitiesNamed("PatchSupport") : [];
  const declaredPatch = patchCapabilities[0];
  // Each resolved format node is read once, however many capabilities or references name it.
  const processed = new WeakSet<object>();
  const nodes =
    patchCapabilities.length > 0 ? indexNodes([...services, ...capabilities]) : new Map();
  const declaredFormats = merge(
    ...patchCapabilities.map((entry) => patchFormats(entry.extra ?? {}, nodes, processed)),
  ).formats;
  let patch: Features["patch"];
  if (lws) {
    patch = feature(
      "available",
      declaredPatch ? cite(SSD.PatchSupport) : `${source}:baseline`,
      merge(
        new Map(Object.entries(declaredFormats)),
        new Map([
          ["application/linkset+json", [JSON_PATCH]],
          ["application/json", [JSON_PATCH]],
        ]),
      ),
    );
  } else if (Object.keys(declaredFormats).length > 0) {
    patch = feature("available", cite(SSD.PatchSupport), { formats: declaredFormats });
  } else if (probe?.acceptPatch?.length) {
    patch = feature("available", "header:Accept-Patch", {
      formats: { "text/turtle": [...new Set(probe.acceptPatch)] },
    });
  } else {
    patch = feature(probe ? "available" : "unknown", probe ? "default:n3-patch" : "none", {
      formats: { "text/turtle": ["text/n3"] },
    });
  }

  // Resumable uploads require an implemented upload profile, just as services do.
  const resumable = authoritative
    ? capabilitiesNamed("ResumableUploads").find((entry) => {
        const profiles = entry.extra?.[DCT.conformsTo] ?? entry.extra?.conformsTo;
        return (Array.isArray(profiles) ? profiles : [profiles]).includes(
          "https://tus.io/protocols/resumable-upload",
        );
      })
    : undefined;
  const resumableUploads = resumable
    ? feature("available", cite(SSD.ResumableUploads), undefined)
    : missing(SSD.ResumableUploads, undefined);
  // SSD D14: RecursiveDelete is a deprecated capability, with no known behaviour.
  // Only the service advertises POST {container}; it never changes resource DELETE.
  const recursive = authoritative ? service(SSD.RecursiveDeleteService) : undefined;
  const recursiveDelete = recursive
    ? feature("available", cite(SSD.RecursiveDeleteService, recursive.endpoint), undefined)
    : missing(SSD.RecursiveDeleteService, undefined);
  const paging = authoritative ? capabilitiesNamed("Pagination")[0] : undefined;
  const pagination = lws
    ? feature("available", `${source}:lws-paging`, undefined)
    : paging
      ? feature("available", cite(SSD.Pagination), undefined)
      : missing(SSD.Pagination, undefined);

  // rdfConneg
  let rdfConneg: Features["rdfConneg"];
  if (lws) {
    const formats = new Set<string>();
    for (const entry of authoritative ? capabilities : []) {
      if (!Array.isArray(entry.type) || !entry.type.includes(SSD.ContentNegotiation)) continue;
      const extra = entry.extra ?? {};
      const sources = values(extra, "source");
      const targets = values(extra, "target");
      const source = sources[0];
      // SSD-CAP-CONNEG-1 and SSD-DM-12: reject the entire malformed declaration.
      if (
        sources.length !== 1 ||
        typeof source !== "string" ||
        !MEDIA_TYPE.test(source) ||
        !RDF_MEDIA_TYPES.has(source.toLowerCase()) ||
        targets.length === 0 ||
        !targets.every((type): type is string => typeof type === "string" && MEDIA_TYPE.test(type))
      )
        continue;
      for (const type of [source, ...targets]) {
        formats.add(type.toLowerCase());
      }
    }
    rdfConneg = formats.size
      ? feature("available", `${source}:ContentNegotiation`, { formats: [...formats] })
      : missing(SSD.ContentNegotiation, { formats: [] });
  } else {
    rdfConneg = feature("available", `${source}:solid-conneg`, { formats: [...SOLID_RDF_FORMATS] });
  }

  return {
    protocol: d.protocol,
    liveUpdates,
    realtimeCollab,
    serverSearch,
    typeIndex,
    accessRequests,
    accessGrants,
    accessControl,
    versioning,
    trash,
    move,
    patch,
    resumableUploads,
    recursiveDelete,
    pagination,
    rdfConneg,
  };
}

/**
 * Index the expanded blank-node objects of a description by `@id`. The Solid mapper expands a
 * shared node once and emits `{ "@id" }` references elsewhere, so a reader must resolve them.
 */
function indexNodes(
  entries: readonly { extra?: unknown }[],
): Map<string, Readonly<Record<string, unknown>>> {
  const index = new Map<string, Readonly<Record<string, unknown>>>();
  const seen = new Set<object>();
  // Entries of a malformed description may be non-objects; optional chaining tolerates them.
  const pending: unknown[] = entries.map((entry) => (entry as { extra?: unknown } | null)?.extra);
  // Breadth-first in document order, so the first expansion of an id wins deterministically.
  for (let next = 0; next < pending.length; next++) {
    const value = pending[next];
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const node = value as Readonly<Record<string, unknown>>;
    const id = node["@id"];
    if (typeof id === "string" && Object.keys(node).length > 1 && !index.has(id)) {
      index.set(id, node);
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return index;
}

/**
 * Read flat PatchSupport source/patchType entries, one per source media type. Read-only
 * sparq fallbacks: nested ssd:format nodes, LWS format maps and mediaType/patchType entries.
 * Linear in the input: each shared format node's types are normalised once.
 */
function patchFormats(
  extra: Readonly<Record<string, unknown>>,
  nodes: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(),
  processed: WeakSet<object> = new WeakSet(),
): Map<string, Set<string>> {
  const formats = new Map<string, Set<string>>();
  const normalise = (patchTypes: unknown[]) => {
    const types = new Set<string>();
    for (const type of patchTypes) {
      if (typeof type === "string" && MEDIA_TYPE.test(type)) types.add(type.toLowerCase());
    }
    return types;
  };
  const add = (sourceType: unknown, types: ReadonlySet<string>) => {
    if (types.size === 0 || typeof sourceType !== "string" || !MEDIA_TYPE.test(sourceType)) return;
    const key = sourceType.toLowerCase();
    const known = formats.get(key) ?? new Set<string>();
    for (const type of types) known.add(type);
    formats.set(key, known);
  };
  const sources = values(extra, "source");
  const patches = values(extra, "patchType");
  // A malformed flat entry must not be rescued by a legacy field (SSD-CAP-PATCH-1/2).
  if (
    ["source", "ssd:source", SSD.source, `${LWS_NS}source`].some((key) => Object.hasOwn(extra, key))
  ) {
    if (sources.length === 1) add(sources[0], normalise(patches));
    return formats;
  }
  // Compatibility only: sparq's current LWS mediaType member has no JSON-LD meaning.
  for (const source of values(extra, "mediaType")) {
    if (record(source)) {
      for (const [sourceType, patchTypes] of Object.entries(source)) {
        add(sourceType, normalise(Array.isArray(patchTypes) ? patchTypes : [patchTypes]));
      }
    } else add(source, normalise(patches));
  }
  for (const value of values(extra, "format")) {
    if (!record(value)) continue;
    const id = value["@id"];
    const format = (typeof id === "string" && nodes.get(id)) || value;
    if (processed.has(format)) continue;
    processed.add(format);
    const sourceTypes = [...values(format, "source"), ...values(format, "mediaType")];
    if (sourceTypes.length > 0) {
      const types = normalise(values(format, "patchType"));
      for (const sourceType of new Set(sourceTypes)) add(sourceType, types);
      continue;
    }
    for (const [sourceType, patchTypes] of Object.entries(format)) {
      add(sourceType, normalise(Array.isArray(patchTypes) ? patchTypes : [patchTypes]));
    }
  }
  return formats;
}

/** Union format maps into a fresh plain object (keys are validated media types). */
function merge(...maps: ReadonlyMap<string, Iterable<string>>[]): {
  formats: Record<string, string[]>;
} {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [key, types] of map) {
      const known = merged.get(key) ?? new Set<string>();
      for (const type of types) known.add(type);
      merged.set(key, known);
    }
  }
  return { formats: Object.fromEntries([...merged].map(([key, types]) => [key, [...types]])) };
}
