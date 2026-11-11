// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { resolveStorageDescription } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import type { BoundPushTopic, PushRegistrarOptions } from "@jeswr/suite-native/push";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

const NOTIFY = "http://www.w3.org/ns/solid/notifications#";
const LWS = "https://www.w3.org/ns/lws#";
const SSD = "https://jeswr.org/ns/solid-sd#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const CONTEXT = "https://www.w3.org/ns/solid/notifications-context/v1";

/** The channel fields used here from the bundled W3C notifications context, never fetched. */
const context = {
  "@context": {
    id: "@id",
    type: "@type",
    WebhookChannel2023: `${NOTIFY}WebhookChannel2023`,
    topic: { "@id": `${NOTIFY}topic`, "@type": "@id" },
    sendTo: { "@id": `${NOTIFY}sendTo`, "@type": "@id" },
    sender: { "@id": `${NOTIFY}sender`, "@type": "@id" },
    endAt: { "@id": `${NOTIFY}endAt`, "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  },
};

class Channel extends TermWrapper {
  iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  text(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, LiteralAs.string);
  }
  setIri(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  setExpiry(value: number) {
    OptionalAs.object(this, `${NOTIFY}endAt`, new Date(value), LiteralFrom.dateTime);
  }
}

function https(value: string, fragment = false): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!fragment && url.hash) ||
    /[\s\\]/u.test(value)
  )
    throw new Error("Invalid push subscription URL");
  return url.href;
}
function sameOrigin(value: string, storage: string): string {
  const url = https(value);
  if (new URL(url).origin !== new URL(storage).origin)
    throw new Error("Foreign push subscription service");
  return url;
}
function channelUrl(value: string, endpoint: string, storage: string): string {
  const url = sameOrigin(value, storage);
  const scope = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  const channel = assertWithinPodScope(scope, url);
  if (channel === scope || new URL(channel).search)
    throw new Error("Invalid push channel location");
  return channel;
}
function webhookService(
  description: Awaited<ReturnType<typeof resolveStorageDescription>>,
  protocol: "solid" | "lws",
) {
  return description.services.find((entry) =>
    protocol === "solid"
      ? entry.type.includes(`${SSD}SolidNotificationService`) &&
        [entry.extra[`${NOTIFY}channelType`]].flat().includes(`${NOTIFY}WebhookChannel2023`)
      : entry.type.includes(`${LWS}NotificationService`) &&
        [
          "subscriptionType",
          "ssd:subscriptionType",
          `${SSD}subscriptionType`,
          `${LWS}subscriptionType`,
        ].some((key) => [entry.extra[key]].flat().includes(`${LWS}WebhookSubscription`)),
  );
}

async function requestBody(topic: string, inbox: string, expires: number): Promise<string> {
  const dataset = new Store();
  const channel = new Channel(DataFactory.blankNode(), dataset, DataFactory);
  channel.setIri(TYPE, `${NOTIFY}WebhookChannel2023`);
  channel.setIri(`${NOTIFY}topic`, https(topic));
  channel.setIri(`${NOTIFY}sendTo`, https(inbox));
  channel.setExpiry(expires);
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads([...dataset]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error("Missing push subscription response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) return text + decoder.decode();
      size += next.value.byteLength;
      if (size > 65_536) throw new Error("Push subscription too large");
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
  }
}

/** App-owned, seven-day subscriptions. No live-update channel or relay SSE connection is created. */
export function createPushSubscriptions(
  fetchFor: (accountId: string) => typeof fetch,
  clock = Date.now,
): PushRegistrarOptions["subscriptions"] {
  return {
    async subscribe({ accountId, protocol, storage, inbox, topics, requestedExpiresAt, signal }) {
      signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const transport = fetchFor(accountId);
      const fetch: typeof globalThis.fetch = (input, init) =>
        transport(input, {
          ...init,
          credentials: "omit",
          redirect: "error",
          signal,
        });
      const description = await resolveStorageDescription(topics[0]?.topic ?? storage, {
        fetch,
        signal,
        cache: createMemoryCache(),
      });
      if (description.protocol !== protocol || description.id !== storage)
        throw new Error("Storage changed");
      const service = webhookService(description, protocol);
      if (!service) throw new Error("This pod does not offer webhook notifications");
      const endpoint = sameOrigin(service.endpoint, storage);
      for (const topic of topics) assertWithinPodScope(description.root, topic.topic);
      const created: BoundPushTopic[] = [];
      const cleanup = new Set<string>();
      try {
        const groups = protocol === "lws" ? [topics] : topics.map((topic) => [topic]);
        for (const group of groups) {
          const first = group[0];
          if (!first) continue;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": protocol === "solid" ? "text/turtle" : "application/lws+json",
              accept:
                protocol === "solid" ? "text/turtle, application/ld+json" : "application/lws+json",
            },
            body:
              protocol === "solid"
                ? await requestBody(first.topic, inbox, requestedExpiresAt)
                : JSON.stringify({
                    "@context": ["https://www.w3.org/ns/lws/v1"],
                    type: "WebhookSubscription",
                    inbox,
                    topic: group.map((topic) => topic.topic),
                    expires: new Date(requestedExpiresAt).toISOString(),
                  }),
          });
          if (!response.ok || response.redirected) throw new Error("Push subscription failed");
          const raw = await boundedText(response, signal);
          let channel: string;
          let expiresAt: number;
          let sender: string | undefined;
          if (protocol === "lws") {
            const result = JSON.parse(raw);
            channel = channelUrl(result.subscription, endpoint, storage);
            cleanup.add(channel);
            expiresAt = Date.parse(result.expires);
          } else {
            const dataset = await parseRdf(raw, response.headers.get("content-type"), {
              baseIRI: endpoint,
              maxBytes: 65_536,
              signal,
              documentLoader: {
                async load(url) {
                  if (url !== CONTEXT) throw new Error("Untrusted notification context");
                  return structuredClone(context);
                },
              },
            });
            const subjects = dataset.getSubjects(
              DataFactory.namedNode(TYPE),
              DataFactory.namedNode(`${NOTIFY}WebhookChannel2023`),
              null,
            );
            if (subjects.length !== 1 || subjects[0]?.termType !== "NamedNode")
              throw new Error("Invalid webhook channel");
            const node = new Channel(subjects[0], dataset, DataFactory);
            channel = channelUrl(subjects[0].value, endpoint, storage);
            cleanup.add(channel);
            if (node.iri(`${NOTIFY}topic`) !== first.topic || node.iri(`${NOTIFY}sendTo`) !== inbox)
              throw new Error("Webhook channel binding changed");
            expiresAt = Date.parse(node.text(`${NOTIFY}endAt`) ?? "");
            const namedSender = node.iri(`${NOTIFY}sender`);
            if (namedSender !== undefined) sender = https(namedSender, true);
          }
          // Keep the server's actual expiry, even when it grants a shorter window.
          if (!Number.isSafeInteger(expiresAt) || expiresAt <= clock())
            throw new Error("Invalid push subscription expiry");
          for (const topic of group)
            created.push({
              index: topic.index,
              kind: topic.kind,
              topic: topic.topic,
              channel,
              expiresAt,
              ...(sender ? { sender } : {}),
            });
        }
        signal.throwIfAborted();
        return created;
      } catch (error) {
        // Partial setup never leaves live untracked topics. Cleanup uses a fresh bounded signal.
        await Promise.allSettled(
          [...cleanup].map((channel) =>
            transport(channel, {
              method: "DELETE",
              redirect: "error",
              credentials: "omit",
              signal: AbortSignal.timeout(10_000),
            }),
          ),
        );
        throw error;
      }
    },
    async remove({ accountId, protocol, storage, topics, signal }) {
      const liveTopics = topics.filter((topic) => topic.expiresAt > clock());
      if (!liveTopics.length) return;
      const transport = fetchFor(accountId);
      const description = await resolveStorageDescription(liveTopics[0]?.topic ?? storage, {
        fetch: transport,
        signal,
        cache: createMemoryCache(),
      });
      const service = webhookService(description, protocol);
      if (!service || description.protocol !== protocol || description.id !== storage)
        throw new Error("Push cleanup service changed");
      const endpoint = sameOrigin(service.endpoint, storage);
      // Validate the complete deletion batch before mutating anything.
      const channels = [
        ...new Set(liveTopics.map((topic) => channelUrl(topic.channel, endpoint, storage))),
      ];
      for (const channel of channels) {
        const response = await transport(channel, {
          method: "DELETE",
          redirect: "error",
          credentials: "omit",
          signal,
        });
        if (!response.ok && response.status !== 404 && response.status !== 410)
          throw new Error("Push subscription cleanup pending");
      }
    },
  };
}
