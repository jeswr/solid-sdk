// AUTHORED-BY GPT-6.1-Sol
// Trusted draft context snapshot for https://jeswr.org/ns/solid-sd/context/v1.
// Source: jeswr/solid-specs@e1e1210 specs/service-description/context/v1.jsonld
export default {
  "@context": {
    "@version": 1.1,
    SolidNotificationService: "https://jeswr.org/ns/solid-sd#SolidNotificationService",
    SparqlQueryService: "https://jeswr.org/ns/solid-sd#SparqlQueryService",
    CrdtSyncService: "https://jeswr.org/ns/solid-sd#CrdtSyncService",
    VersioningService: "https://jeswr.org/ns/solid-sd#VersioningService",
    TrashService: "https://jeswr.org/ns/solid-sd#TrashService",
    RecursiveDeleteService: "https://jeswr.org/ns/solid-sd#RecursiveDeleteService",
    AccessControl: "https://jeswr.org/ns/solid-sd#AccessControl",
    PatchSupport: "https://jeswr.org/ns/solid-sd#PatchSupport",
    ResumableUploads: "https://jeswr.org/ns/solid-sd#ResumableUploads",
    Pagination: "https://jeswr.org/ns/solid-sd#Pagination",
    ContentNegotiation: "https://jeswr.org/ns/solid-sd#ContentNegotiation",
    SseSubscription: "https://jeswr.org/ns/solid-sd#SseSubscription",
    WebSocketSubscription: "https://jeswr.org/ns/solid-sd#WebSocketSubscription",
    channelType: {
      "@id": "http://www.w3.org/ns/solid/notifications#channelType",
      "@type": "@vocab",
      "@context": {
        WebSocketChannel2023: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
        StreamingHTTPChannel2023:
          "http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023",
        WebhookChannel2023: "http://www.w3.org/ns/solid/notifications#WebhookChannel2023",
        LDNChannel2023: "http://www.w3.org/ns/solid/notifications#LDNChannel2023",
        WebPushChannel2023: "http://www.w3.org/ns/solid/notifications#WebPushChannel2023",
      },
    },
    feature: {
      "@id": "http://www.w3.org/ns/solid/notifications#feature",
      "@type": "@vocab",
      "@context": {
        startAt: "http://www.w3.org/ns/solid/notifications#startAt",
        endAt: "http://www.w3.org/ns/solid/notifications#endAt",
        rate: "http://www.w3.org/ns/solid/notifications#rate",
        state: "http://www.w3.org/ns/solid/notifications#state",
        accept: "http://www.w3.org/ns/solid/notifications#accept",
      },
    },
    model: {
      "@id": "https://jeswr.org/ns/solid-sd#model",
      "@type": "@vocab",
      "@context": {
        WAC: "https://jeswr.org/ns/solid-sd#WAC",
        ACP: "https://jeswr.org/ns/solid-sd#ACP",
        ODRLGrants: "https://jeswr.org/ns/solid-sd#ODRLGrants",
      },
    },
    source: "https://jeswr.org/ns/solid-sd#source",
    patchType: "https://jeswr.org/ns/solid-sd#patchType",
    target: "https://jeswr.org/ns/solid-sd#target",
    retention: {
      "@id": "https://jeswr.org/ns/solid-sd#retention",
      "@type": "http://www.w3.org/2001/XMLSchema#duration",
    },
    roomTemplate: "https://jeswr.org/ns/solid-sd#roomTemplate",
  },
};
