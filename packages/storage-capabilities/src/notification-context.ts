// AUTHORED-BY Codex GPT-6.1-Sol
import type { DocumentLoader } from "@jeswr/fetch-rdf";

// Bundled public W3C context, retrieved 2026-10-26. Resolving a description never
// sends authenticated requests to a remote JSON-LD context or follows nested contexts.
// Source: https://www.w3.org/ns/solid/notifications-context/v1
const context = {
  "@context": {
    "@version": 1.1,
    "@protected": true,
    id: "@id",
    type: "@type",
    notify: "http://www.w3.org/ns/solid/notifications#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    EventSourceChannel2023: "notify:EventSourceChannel2023",
    LDNChannel2023: "notify:LDNChannel2023",
    StreamingHTTPChannel2023: "notify:StreamingHTTPChannel2023",
    WebhookChannel2023: "notify:WebhookChannel2023",
    WebSocketChannel2023: "notify:WebSocketChannel2023",
    accept: "notify:accept",
    channel: { "@id": "notify:channel", "@type": "@id" },
    channelType: { "@id": "notify:channelType", "@type": "@vocab" },
    endAt: { "@id": "notify:endAt", "@type": "xsd:dateTime" },
    feature: { "@id": "notify:feature", "@type": "@vocab" },
    rate: { "@id": "notify:rate", "@type": "xsd:duration" },
    receiveFrom: { "@id": "notify:receiveFrom", "@type": "@id" },
    sender: { "@id": "notify:sender", "@type": "@id" },
    sendTo: { "@id": "notify:sendTo", "@type": "@id" },
    state: "notify:state",
    startAt: { "@id": "notify:startAt", "@type": "xsd:dateTime" },
    subscription: { "@id": "notify:subscription", "@type": "@id" },
    topic: { "@id": "notify:topic", "@type": "@id" },
  },
};

/** Only the standard notification context is accepted; all other remote contexts fail closed. */
export const notificationDocumentLoader: DocumentLoader = {
  async load(url) {
    if (
      url !== "https://www.w3.org/ns/solid/notifications-context/v1" &&
      url !== "https://www.w3.org/ns/solid/notification/v1"
    )
      throw new Error("Unsupported remote description context");
    return structuredClone(context);
  },
};
