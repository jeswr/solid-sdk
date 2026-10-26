// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import * as vocab from "./vocab.js";

test("exports every ADR-002 vocabulary IRI with its exact namespace", () => {
  expect(vocab.LWS).toEqual({
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
  });
  expect(vocab.DID).toEqual({
    service: "https://www.w3.org/ns/did#service",
    serviceEndpoint: "https://www.w3.org/ns/did#serviceEndpoint",
  });
  expect(vocab.SEC).toEqual({
    verificationMethod: "https://w3id.org/security#verificationMethod",
    authentication: "https://w3id.org/security#authentication",
  });
  expect(vocab.DCT).toEqual({
    conformsTo: "http://purl.org/dc/terms/conformsTo",
  });
  expect(vocab.NOTIFY).toEqual({
    subscription: "http://www.w3.org/ns/solid/notifications#subscription",
    channelType: "http://www.w3.org/ns/solid/notifications#channelType",
    feature: "http://www.w3.org/ns/solid/notifications#feature",
    WebSocketChannel2023: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
    StreamingHTTPChannel2023: "http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023",
    WebhookChannel2023: "http://www.w3.org/ns/solid/notifications#WebhookChannel2023",
    LDNChannel2023: "http://www.w3.org/ns/solid/notifications#LDNChannel2023",
    WebPushChannel2023: "http://www.w3.org/ns/solid/notifications#WebPushChannel2023",
  });
  expect(vocab.SOLID).toEqual({
    storageDescription: "http://www.w3.org/ns/solid/terms#storageDescription",
    owner: "http://www.w3.org/ns/solid/terms#owner",
  });
  expect(vocab.PIM).toEqual({
    Storage: "http://www.w3.org/ns/pim/space#Storage",
  });
  expect(vocab.ACQ).toEqual({
    endpoint: "http://www.w3.org/ns/solid/sparql#endpoint",
  });
  expect(vocab.ACL).toEqual({
    accessControl: "http://www.w3.org/ns/auth/acl#accessControl",
  });
  expect(vocab.ACP).toEqual({
    accessControl: "http://www.w3.org/ns/solid/acp#accessControl",
  });
  expect(vocab.SSD).toEqual({
    SolidNotificationService: "https://jeswr.org/ns/solid-sd#SolidNotificationService",
    LegacyUpdatesVia: "https://jeswr.org/ns/solid-sd#LegacyUpdatesVia",
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
  });
});
