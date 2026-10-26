// AUTHORED-BY Claude Opus 5.5
import type {
  CapabilityEntry,
  Feature,
  Features,
  ProbeResult,
  ServiceEntry,
  StorageDescription,
} from "./types.js";
import { LWS, NOTIFY, SSD } from "./vocab.js";

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
function localName(iri: unknown): string {
  if (typeof iri !== "string") return "";
  return iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"), iri.lastIndexOf(":")) + 1);
}

/** Values of an extra member, under its raw JSON key or any expanded IRI with that local name. */
function values(extra: Readonly<Record<string, unknown>>, name: string): unknown[] {
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (key === name || (key.includes(":") && localName(key) === name)) {
      found.push(...(Array.isArray(value) ? value : [value]));
    }
  }
  return found;
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
  /** Non-notification entries are trusted: same-origin description (foreign ones are notify-only). */
  const authoritative = described && !(d.evidence ?? []).includes("cross-origin-description");
  const typed = (entry: { type?: readonly string[] }, ...iris: string[]) =>
    Array.isArray(entry.type) && entry.type.some((type) => iris.includes(type));
  const service = (...iris: string[]) => services.find((entry) => typed(entry, ...iris));
  const capability = (name: string) =>
    capabilities.find(
      (entry) => Array.isArray(entry.type) && entry.type.some((type) => localName(type) === name),
    );
  const cite = (type: string, endpoint?: string) =>
    `${source}:${localName(type)}${endpoint === undefined ? "" : `:${endpoint}`}`;
  const absent = (type: string) => `${source}:absent:${localName(type)}`;
  /** For rows whose only negative evidence is "the description does not list it". */
  const missing = <T>(type: string, detail: T): Feature<T> =>
    authoritative
      ? feature("unavailable", absent(type), detail)
      : feature("unknown", "none", detail);

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
      // ADR-008 did:service entries carry the channel as ssd:channelType; legacy-ws is only ever
      // set by the resolver's own Updates-Via mapping, never read from description content.
      const kinds = [...entry.type, ...strings(entry.extra ?? {}, "channelType")];
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
    if (authoritative && typed(entry, LWS.NotificationService)) {
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
    : notificationServices > 0 || described
      ? feature(
          "unavailable",
          notificationServices > 0
            ? `${source}:unsupported-channels`
            : absent(SSD.SolidNotificationService),
          { channels: [] },
        )
      : feature("unknown", "none", { channels: [] });

  // realtimeCollab
  const crdt = authoritative
    ? services.find(
        (entry) =>
          typed(entry, SSD.CrdtSyncService) &&
          Array.isArray(entry.conformsTo) &&
          entry.conformsTo.includes(Y_PROTOCOL_V1),
      )
    : undefined;
  const realtimeCollab = crdt
    ? feature("available", cite(SSD.CrdtSyncService, crdt.endpoint), {
        endpoint: crdt.endpoint,
        // The find above only matches entries whose conformsTo is an array.
        protocols: [...(crdt.conformsTo as readonly string[])],
      })
    : missing(SSD.CrdtSyncService, { protocols: [] as string[] });

  // serverSearch
  const sparql = authoritative ? service(SSD.SparqlQueryService) : undefined;
  const serverSearch = sparql
    ? feature("available", cite(SSD.SparqlQueryService, sparql.endpoint), {
        endpoint: sparql.endpoint,
      })
    : feature("unavailable", absent(SSD.SparqlQueryService), {});

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
    const entry = authoritative ? service(lwsType, ssdType) : undefined;
    return entry
      ? feature(
          "available",
          cite(entry.type.includes(lwsType) ? lwsType : ssdType, entry.endpoint),
          {
            endpoint: entry.endpoint,
            profiles: [...(entry.conformsTo ?? [])],
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
    const declared = authoritative
      ? capabilities.find((entry) => typed(entry, SSD.AccessControl))
      : undefined;
    const models = new Set(
      declared ? strings(declared.extra ?? {}, "model").map((iri) => ACCESS_MODELS[iri]) : [],
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
  const declaredPatch = authoritative ? capability("PatchSupport") : undefined;
  const declaredFormats = patchFormats(declaredPatch?.extra ?? {});
  let patch: Features["patch"];
  if (lws) {
    patch = feature(
      "available",
      declaredPatch ? cite(SSD.PatchSupport) : `${source}:baseline`,
      merge(
        declaredFormats,
        new Map([
          ["application/linkset+json", [JSON_PATCH]],
          ["application/json", [JSON_PATCH]],
        ]),
      ),
    );
  } else if (declaredFormats.size > 0) {
    patch = feature("available", cite(SSD.PatchSupport), merge(declaredFormats));
  } else if (probe?.acceptPatch?.length) {
    patch = feature("available", "header:Accept-Patch", {
      formats: { "text/turtle": [...new Set(probe.acceptPatch)] },
    });
  } else {
    patch = feature(probe ? "available" : "unknown", probe ? "default:n3-patch" : "none", {
      formats: { "text/turtle": ["text/n3"] },
    });
  }

  // resumableUploads / recursiveDelete / pagination
  const capabilityRow = (name: string) => {
    const entry = authoritative ? capability(name) : undefined;
    return entry
      ? feature("available", `${source}:${name}`, undefined)
      : missing(`${SSD_NS}${name}`, undefined);
  };
  const resumableUploads = capabilityRow("ResumableUploads");
  const recursiveDelete = capabilityRow("RecursiveDelete");
  const pagination = lws
    ? feature("available", `${source}:lws-paging`, undefined)
    : feature("unavailable", `${source}:solid-no-paging`, undefined);

  // rdfConneg
  let rdfConneg: Features["rdfConneg"];
  if (lws) {
    const formats = new Set<string>();
    for (const entry of authoritative ? capabilities : []) {
      if (
        !Array.isArray(entry.type) ||
        !entry.type.some((type) => localName(type) === "ContentNegotiation")
      )
        continue;
      const extra = entry.extra ?? {};
      const sources = strings(extra, "source").map((type) => type.toLowerCase());
      if (!sources.some((type) => RDF_MEDIA_TYPES.has(type))) continue;
      for (const type of [...sources, ...strings(extra, "target")]) {
        formats.add(type.toLowerCase());
      }
    }
    rdfConneg = formats.size
      ? feature("available", `${source}:ContentNegotiation`, { formats: [...formats] })
      : feature("unavailable", `${source}:opaque-bodies`, { formats: [] });
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
 * Read a PatchSupport `format` member: either a JSON map `{ "<source type>": "<patch type>" | [...] }`
 * (LWS example) or RDF-derived `{ source, patchType }` nodes (ADR-008), single or repeated.
 */
function patchFormats(extra: Readonly<Record<string, unknown>>): Map<string, string[]> {
  const formats = new Map<string, string[]>();
  const add = (sourceType: unknown, patchTypes: unknown[]) => {
    if (typeof sourceType !== "string" || !MEDIA_TYPE.test(sourceType)) return;
    const types = patchTypes
      .filter((type): type is string => typeof type === "string" && MEDIA_TYPE.test(type))
      .map((type) => type.toLowerCase());
    if (types.length === 0) return;
    const key = sourceType.toLowerCase();
    formats.set(key, [...new Set([...(formats.get(key) ?? []), ...types])]);
  };
  for (const format of values(extra, "format")) {
    if (!record(format)) continue;
    const sourceTypes = values(format, "source");
    if (sourceTypes.length > 0) {
      for (const sourceType of sourceTypes) add(sourceType, values(format, "patchType"));
      continue;
    }
    for (const [sourceType, patchTypes] of Object.entries(format)) {
      add(sourceType, Array.isArray(patchTypes) ? patchTypes : [patchTypes]);
    }
  }
  return formats;
}

/** Union format maps into a fresh plain object (keys are validated media types). */
function merge(...maps: ReadonlyMap<string, readonly string[]>[]): {
  formats: Record<string, string[]>;
} {
  const merged = new Map<string, string[]>();
  for (const map of maps) {
    for (const [key, types] of map) {
      merged.set(key, [...new Set([...(merged.get(key) ?? []), ...types])]);
    }
  }
  return { formats: Object.fromEntries(merged) };
}
