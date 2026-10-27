// AUTHORED-BY GPT-6.1-Sol

/**
 * Representative sparq LWS CID based on ADR-002's fixture and SDK-core STATUS.md.
 * Public example metadata, not a recorded response. The deployed service set has
 * webhooks, type index/search, access requests/grants, and no capability array.
 */
export const sparqLwsCid = {
  "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
  id: "https://lws.example/.well-known/storage",
  type: ["Storage"],
  service: [
    {
      id: "https://lws.example/.well-known/storage#root",
      type: "StorageRoot",
      serviceEndpoint: "https://lws.example/",
    },
    {
      id: "https://lws.example/.well-known/storage#notifications",
      type: "NotificationService",
      serviceEndpoint: "https://lws.example/notifications/",
      subscriptionType: ["WebhookSubscription"],
    },
    {
      type: "TypeIndexService",
      serviceEndpoint: "https://lws.example/type-index/",
    },
    {
      type: "TypeSearchService",
      serviceEndpoint: "https://lws.example/type-search/",
    },
    {
      type: "AccessRequestService",
      serviceEndpoint: "https://lws.example/access-requests/",
      conformsTo: ["https://www.w3.org/ns/lws#AccessProfile"],
    },
    {
      type: "AccessGrantService",
      serviceEndpoint: "https://lws.example/access-grants/",
      conformsTo: ["https://www.w3.org/ns/lws#AccessProfile"],
    },
  ],
  verificationMethod: [
    {
      id: "https://lws.example/.well-known/storage#webhook-key",
      type: "JsonWebKey2020",
      controller: "https://lws.example/.well-known/storage",
      publicKeyJwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    },
  ],
} as const;
