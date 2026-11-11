// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createPodClient } from "@jeswr/storage-client";
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
import { discoveryCache } from "./channels/discovery.js";
import { lwsSubscriptionBody, lwsSubscriptionService } from "./channels/lws-subscription.js";

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

/** Validated channel metadata; applications retain their own account, labels and routes. */
export interface WebhookTopic {
  topic: string;
  channel: string;
  expiresAt: number;
  sender?: string;
}

/** One storage's subscription request, using an already selected account's pod fetch. */
export interface WebhookSubscriptionRequest {
  protocol: "solid" | "lws";
  storage: string;
  inbox: string;
  topics: readonly string[];
  requestedExpiresAt: number;
  signal: AbortSignal;
}

/** Persist returned channels and retry failed removals until their actual expiry. */
export interface WebhookSubscriptions {
  subscribe(request: WebhookSubscriptionRequest): Promise<WebhookTopic[]>;
  remove(
    request: Pick<WebhookSubscriptionRequest, "protocol" | "storage" | "signal"> & {
      topics: readonly WebhookTopic[];
    },
  ): Promise<void>;
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
async function requestBody(topic: string, inbox: string, expires: number): Promise<string> {
  const dataset = new Store();
  const channel = new TermWrapper(DataFactory.blankNode(), dataset, DataFactory);
  OptionalAs.object(channel, TYPE, `${NOTIFY}WebhookChannel2023`, NamedNodeFrom.string);
  OptionalAs.object(channel, `${NOTIFY}topic`, https(topic), NamedNodeFrom.string);
  OptionalAs.object(channel, `${NOTIFY}sendTo`, https(inbox), NamedNodeFrom.string);
  OptionalAs.object(channel, `${NOTIFY}endAt`, new Date(expires), LiteralFrom.dateTime);
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

/** Pod webhook lifecycle without opening a live stream or managing relay authentication. */
export function createWebhookSubscriptions(
  transport: typeof fetch,
  clock = Date.now,
): WebhookSubscriptions {
  const fetchWithSignal =
    (signal: AbortSignal): typeof fetch =>
    async (input, init) => {
      const response = await transport(input, {
        ...init,
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (response.redirected) throw new Error("Push subscription redirect refused");
      return response;
    };
  return {
    async subscribe({ protocol, storage, inbox, topics, requestedExpiresAt, signal }) {
      signal.throwIfAborted();
      const firstTopic = topics[0];
      if (firstTopic === undefined) return [];
      signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const fetch = fetchWithSignal(signal);
      const { description } = await createPodClient({
        storage: firstTopic,
        fetch,
        signal,
        capabilities: discoveryCache(),
        clock,
      });
      if (description.protocol !== protocol || description.id !== storage)
        throw new Error("Storage changed");
      const service =
        protocol === "lws"
          ? lwsSubscriptionService(description, `${LWS}WebhookSubscription`)
          : description.services.find(
              (entry) =>
                entry.type.includes(`${SSD}SolidNotificationService`) &&
                [entry.extra[`${NOTIFY}channelType`]]
                  .flat()
                  .includes(`${NOTIFY}WebhookChannel2023`),
            );
      if (!service) throw new Error("This pod does not offer webhook notifications");
      const endpoint = sameOrigin(service.endpoint, storage);
      for (const topic of topics) assertWithinPodScope(description.root, topic);
      const created: WebhookTopic[] = [];
      const cleanup = new Set<string>();
      try {
        const groups = protocol === "lws" ? [topics] : topics.map((topic) => [topic]);
        for (const group of groups) {
          const first = group[0]!;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": protocol === "solid" ? "text/turtle" : "application/lws+json",
              accept:
                protocol === "solid" ? "text/turtle, application/ld+json" : "application/lws+json",
            },
            body:
              protocol === "solid"
                ? await requestBody(first, inbox, requestedExpiresAt)
                : JSON.stringify(
                    lwsSubscriptionBody(
                      group,
                      "WebhookSubscription",
                      requestedExpiresAt,
                      https(inbox),
                    ),
                  ),
          });
          if (!response.ok) throw new Error("Push subscription failed");
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
            const node = new TermWrapper(subjects[0], dataset, DataFactory);
            channel = channelUrl(subjects[0].value, endpoint, storage);
            cleanup.add(channel);
            if (
              OptionalFrom.subjectPredicate(node, `${NOTIFY}topic`, NamedNodeAs.string) !== first ||
              OptionalFrom.subjectPredicate(node, `${NOTIFY}sendTo`, NamedNodeAs.string) !== inbox
            )
              throw new Error("Webhook channel binding changed");
            expiresAt = Date.parse(
              OptionalFrom.subjectPredicate(node, `${NOTIFY}endAt`, LiteralAs.string) ?? "",
            );
            const namedSender = OptionalFrom.subjectPredicate(
              node,
              `${NOTIFY}sender`,
              NamedNodeAs.string,
            );
            if (namedSender !== undefined) sender = https(namedSender, true);
          }
          // Keep the server's actual expiry, even when it grants a shorter window.
          if (!Number.isSafeInteger(expiresAt) || expiresAt <= clock())
            throw new Error("Invalid push subscription expiry");
          for (const topic of group)
            created.push({
              topic,
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
    async remove({ protocol, storage, topics, signal }) {
      const liveTopics = topics.filter((topic) => topic.expiresAt > clock());
      if (!liveTopics.length) return;
      signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const fetch = fetchWithSignal(signal);
      const { description } = await createPodClient({
        storage: liveTopics[0]!.topic,
        fetch,
        signal,
        capabilities: discoveryCache(),
        clock,
      });
      const service =
        protocol === "lws"
          ? lwsSubscriptionService(description, `${LWS}WebhookSubscription`)
          : description.services.find(
              (entry) =>
                entry.type.includes(`${SSD}SolidNotificationService`) &&
                [entry.extra[`${NOTIFY}channelType`]]
                  .flat()
                  .includes(`${NOTIFY}WebhookChannel2023`),
            );
      if (!service || description.protocol !== protocol || description.id !== storage)
        throw new Error("Push cleanup service changed");
      const endpoint = sameOrigin(service.endpoint, storage);
      // Validate the complete deletion batch before mutating anything.
      const channels = [
        ...new Set(liveTopics.map((topic) => channelUrl(topic.channel, endpoint, storage))),
      ];
      for (const channel of channels) {
        const response = await fetch(channel, {
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
