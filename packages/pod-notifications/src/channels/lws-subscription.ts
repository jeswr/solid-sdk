// AUTHORED-BY Codex GPT-6
import type { PodClient } from "@jeswr/storage-client";

/** Select the requested subscription service independently of the preferred live channel. */
export function lwsSubscriptionService(description: PodClient["description"], type: string) {
  return description.services.find(
    (service) =>
      service.type.includes("https://www.w3.org/ns/lws#NotificationService") &&
      new URL(service.endpoint).origin === new URL(description.root).origin &&
      [
        "subscriptionType",
        "ssd:subscriptionType",
        "https://jeswr.org/ns/solid-sd#subscriptionType",
        "https://www.w3.org/ns/lws#subscriptionType",
      ].some((key) => [service.extra[key]].flat().includes(type)),
  );
}

/** LWS's JSON protocol request, shared by live and device webhook subscriptions. */
export function lwsSubscriptionBody(
  topics: readonly string[],
  type: string,
  expires: number,
  inbox?: string,
) {
  return {
    "@context": ["https://www.w3.org/ns/lws/v1"],
    type,
    ...(inbox === undefined ? {} : { inbox }),
    topic: topics,
    expires: new Date(expires).toISOString(),
  };
}
