// AUTHORED-BY Codex GPT-6
import { createWebhookSubscriptions } from "@jeswr/pod-notifications";
import type { PushRegistrarOptions } from "@jeswr/suite-native/push";

/** Select the account fetch and join SDK channel metadata with the app's selected topics. */
export function createPushSubscriptions(
  fetchFor: (accountId: string) => typeof fetch,
  clock = Date.now,
): PushRegistrarOptions["subscriptions"] {
  return {
    async subscribe(request) {
      const bindings = await createWebhookSubscriptions(
        fetchFor(request.accountId),
        clock,
      ).subscribe({
        ...request,
        topics: request.topics.map((topic) => topic.topic),
      });
      return bindings.map((binding, index) => ({
        ...binding,
        index: request.topics[index]!.index,
        kind: request.topics[index]!.kind,
      }));
    },
    async remove(request) {
      // Expired subscriptions need no live account session.
      if (request.topics.every((topic) => topic.expiresAt <= clock())) return;
      await createWebhookSubscriptions(fetchFor(request.accountId), clock).remove(request);
    },
  };
}
