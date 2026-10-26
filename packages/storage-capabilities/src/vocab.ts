// AUTHORED-BY Codex GPT-6.1-Sol

/** LWS vocabulary IRIs recognised by ADR-002. */
export const LWS = {
  Storage: "https://www.w3.org/ns/lws#Storage",
  StorageRoot: "https://www.w3.org/ns/lws#StorageRoot",
  NotificationService: "https://www.w3.org/ns/lws#NotificationService",
  WebhookSubscription: "https://www.w3.org/ns/lws#WebhookSubscription",
  TypeIndexService: "https://www.w3.org/ns/lws#TypeIndexService",
  TypeSearchService: "https://www.w3.org/ns/lws#TypeSearchService",
  AccessRequestService: "https://www.w3.org/ns/lws#AccessRequestService",
  AccessGrantService: "https://www.w3.org/ns/lws#AccessGrantService",
  AccessProfile: "https://www.w3.org/ns/lws#AccessProfile",
  MoveResource: "https://www.w3.org/ns/lws#MoveResource",
  capability: "https://www.w3.org/ns/lws#capability",
  subscriptionType: "https://www.w3.org/ns/lws#subscriptionType",
  appliesTo: "https://www.w3.org/ns/lws#appliesTo",
  preservesIdentifier: "https://www.w3.org/ns/lws#preservesIdentifier",
} as const;

/** DID vocabulary IRIs recognised by ADR-002. */
export const DID = {
  service: "https://www.w3.org/ns/did#service",
  serviceEndpoint: "https://www.w3.org/ns/did#serviceEndpoint",
} as const;

/** SEC vocabulary IRIs recognised by ADR-002. */
export const SEC = {
  verificationMethod: "https://w3id.org/security#verificationMethod",
  authentication: "https://w3id.org/security#authentication",
} as const;

/** DCT vocabulary IRIs recognised by ADR-002. */
export const DCT = {
  conformsTo: "http://purl.org/dc/terms/conformsTo",
} as const;

/** NOTIFY vocabulary IRIs recognised by ADR-002. */
export const NOTIFY = {
  subscription: "http://www.w3.org/ns/solid/notifications#subscription",
  channelType: "http://www.w3.org/ns/solid/notifications#channelType",
  feature: "http://www.w3.org/ns/solid/notifications#feature",
  WebSocketChannel2023: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
  StreamingHTTPChannel2023: "http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023",
  WebhookChannel2023: "http://www.w3.org/ns/solid/notifications#WebhookChannel2023",
  LDNChannel2023: "http://www.w3.org/ns/solid/notifications#LDNChannel2023",
  WebPushChannel2023: "http://www.w3.org/ns/solid/notifications#WebPushChannel2023",
} as const;

/** SOLID vocabulary IRIs recognised by ADR-002. */
export const SOLID = {
  storageDescription: "http://www.w3.org/ns/solid/terms#storageDescription",
  owner: "http://www.w3.org/ns/solid/terms#owner",
} as const;

/** PIM vocabulary IRIs recognised by ADR-002. */
export const PIM = {
  Storage: "http://www.w3.org/ns/pim/space#Storage",
} as const;

/** ACQ vocabulary IRIs recognised by ADR-002. */
export const ACQ = {
  endpoint: "http://www.w3.org/ns/solid/sparql#endpoint",
} as const;

/** ACL vocabulary IRIs recognised by ADR-002. */
export const ACL = {
  accessControl: "http://www.w3.org/ns/auth/acl#accessControl",
} as const;

/** ACP vocabulary IRIs recognised by ADR-002. */
export const ACP = {
  accessControl: "http://www.w3.org/ns/solid/acp#accessControl",
} as const;

/** SSD vocabulary IRIs recognised by ADR-002. */
export const SSD = {
  SolidNotificationService: "https://jeswr.org/ns/solid-sd#SolidNotificationService",
  SparqlQueryService: "https://jeswr.org/ns/solid-sd#SparqlQueryService",
  CrdtSyncService: "https://jeswr.org/ns/solid-sd#CrdtSyncService",
  VersioningService: "https://jeswr.org/ns/solid-sd#VersioningService",
  TrashService: "https://jeswr.org/ns/solid-sd#TrashService",
  AccessControl: "https://jeswr.org/ns/solid-sd#AccessControl",
  PatchSupport: "https://jeswr.org/ns/solid-sd#PatchSupport",
  RecursiveDelete: "https://jeswr.org/ns/solid-sd#RecursiveDelete",
  StreamingHttpChannel: "https://jeswr.org/ns/solid-sd#StreamingHttpChannel",
  SseSubscription: "https://jeswr.org/ns/solid-sd#SseSubscription",
  WebSocketSubscription: "https://jeswr.org/ns/solid-sd#WebSocketSubscription",
} as const;
