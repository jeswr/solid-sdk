// AUTHORED-BY Codex GPT-6.1-Sol
// Trusted draft context snapshot for https://www.w3.org/ns/lws/v1.
// Source: jeswr/solid-specs@e1e1210 tools/spec-check/contexts/lws-v1.stand-in.jsonld
// The draft spec-check stand-in supplies the LWS terms used by its examples.
export default {
  "@context": {
    "@version": 1.1,
    "@protected": true,
    id: "@id",
    type: "@type",
    Storage: "https://www.w3.org/ns/lws#Storage",
    StorageRoot: "https://www.w3.org/ns/lws#StorageRoot",
    Container: "https://www.w3.org/ns/lws#Container",
    DataResource: "https://www.w3.org/ns/lws#DataResource",
    NotificationService: "https://www.w3.org/ns/lws#NotificationService",
    WebhookSubscription: "https://www.w3.org/ns/lws#WebhookSubscription",
    TypeIndexService: "https://www.w3.org/ns/lws#TypeIndexService",
    TypeSearchService: "https://www.w3.org/ns/lws#TypeSearchService",
    AccessRequestService: "https://www.w3.org/ns/lws#AccessRequestService",
    AccessGrantService: "https://www.w3.org/ns/lws#AccessGrantService",
    AccessProfile: "https://www.w3.org/ns/lws#AccessProfile",
    MoveResource: "https://www.w3.org/ns/lws#MoveResource",
    capability: {
      "@id": "https://www.w3.org/ns/lws#capability",
      "@container": "@set",
    },
    subscriptionType: {
      "@id": "https://www.w3.org/ns/lws#subscriptionType",
      "@type": "@vocab",
      "@container": "@set",
    },
    appliesTo: {
      "@id": "https://www.w3.org/ns/lws#appliesTo",
      "@type": "@vocab",
      "@container": "@set",
    },
    preservesIdentifier: {
      "@id": "https://www.w3.org/ns/lws#preservesIdentifier",
      "@type": "http://www.w3.org/2001/XMLSchema#boolean",
    },
    conformsTo: {
      "@id": "http://purl.org/dc/terms/conformsTo",
      "@type": "@id",
      "@container": "@set",
    },
    format: {
      "@id": "http://purl.org/dc/terms/format",
    },
  },
};
