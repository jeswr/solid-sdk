// AUTHORED-BY Codex GPT-6

import { resolveStorageDescription } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { isNativeApp } from "@jeswr/suite-native";
import {
  createPush,
  createPushRegistrar,
  isPushRoute,
  type PushClient,
  type PushRegistrar,
  type PushRegistrarState,
  type PushTopicSpec,
} from "@jeswr/suite-native/push";
import type { AccountsContextValue } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { pushRelayUrl } from "./config";
import { createPushSubscriptions } from "./subscriptions";
import { discoverPushTopics } from "./topics";

export interface PushRuntime {
  push: PushClient;
  registrar: PushRegistrar;
  enable(account: SuiteAccount): Promise<void>;
  resume(): Promise<void>;
}

export function pushStateStore(storage: Pick<Storage, "getItem" | "setItem">, relayUrl: string) {
  const key = `suite.push.v1.${relayUrl}`;
  return {
    async load(): Promise<PushRegistrarState | null> {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    },
    async save(state: PushRegistrarState): Promise<void> {
      storage.setItem(key, JSON.stringify(state));
    },
  };
}

export function signedIn(accounts: AccountsContextValue, id: string): boolean {
  return (
    accounts.isSignedInAccount?.(id) ?? (accounts.active?.id === id && accounts.status === "ready")
  );
}

/** This factory never loads the native binding on web or when the signed build omits a relay. */
export async function createPushRuntime({
  accounts,
  relayUrl = pushRelayUrl(),
  loadPush = async () => createPush((await import("@jeswr/suite-native/capacitor")).pushPlugin),
  store,
  discoverTopics = discoverPushTopics,
}: {
  accounts: () => AccountsContextValue;
  relayUrl?: string | null;
  loadPush?: () => Promise<PushClient>;
  store?: {
    load(): Promise<PushRegistrarState | null>;
    save(state: PushRegistrarState): Promise<void>;
  };
  discoverTopics?: (
    account: SuiteAccount,
    fetch: typeof globalThis.fetch,
  ) => Promise<PushTopicSpec[]>;
}): Promise<PushRuntime | null> {
  if (!isNativeApp() || !relayUrl) return null;
  const origin = pushRelayUrl(relayUrl);
  if (!origin) return null;
  const push = await loadPush();
  const fetchFor = (accountId: string, extraResourceOrigins: string[] = []) => {
    const shell = accounts();
    const account = shell.accounts.find((entry) => entry.id === accountId);
    if (account?.kind !== "solid" || !shell.fetchFor)
      throw new Error("Sign in to manage push notifications");
    return shell.fetchFor(account, { extraResourceOrigins });
  };
  const subscriptions = createPushSubscriptions((accountId) => {
    return fetchFor(accountId);
  });
  const registrar = createPushRegistrar({
    relayUrl: origin,
    push,
    store: store ?? pushStateStore(localStorage, origin),
    subscriptions,
    fetch: (input, init) => {
      const active = accounts().active;
      if (!active) throw new Error("Sign in to manage push notifications");
      return fetchFor(active.id, [origin])(input, init);
    },
    fetchFor: (accountId) => fetchFor(accountId, [origin]),
  });
  const registrationRequest = async (account: SuiteAccount) => {
    if (account.kind !== "solid" || !signedIn(accounts(), account.id))
      throw new Error("Sign in to enable push notifications");
    const topics = await discoverTopics(account, fetchFor(account.id));
    const description = await resolveStorageDescription(account.storageUrl, {
      fetch: fetchFor(account.id),
      cache: createMemoryCache(),
    });
    if (!signedIn(accounts(), account.id)) throw new Error("Account changed");
    return {
      accountId: account.id,
      webId: account.webId,
      protocol: description.protocol,
      storage: description.id,
      topics,
    };
  };
  let resuming: Promise<void> | undefined;
  const resume = async () => {
    const saved = await registrar.snapshot();
    const ids = [...new Set(saved.registrations.map((entry) => entry.accountId))];
    const failures: unknown[] = [];
    // Silence signed-out accounts before retrying any tokenless remote cleanup.
    for (const id of ids)
      if (!accounts().accounts.some((account) => account.id === id)) {
        try {
          await registrar.remove(id);
        } catch (error) {
          failures.push(error);
        }
      }
    try {
      await registrar.retryCleanup();
    } catch (error) {
      failures.push(error);
    }
    for (const id of ids) {
      if (
        !signedIn(accounts(), id) ||
        !saved.registrations.some((entry) => entry.accountId === id && !entry.removing)
      )
        continue;
      try {
        const account = accounts().accounts.find((account) => account.id === id);
        if (!account) continue;
        const request = await registrationRequest(account);
        const previous = saved.registrations.find(
          (entry) => entry.accountId === id && entry.storage === request.storage && !entry.removing,
        );
        if (previous && JSON.stringify(previous.requestedTopics) === JSON.stringify(request.topics))
          await registrar.renew(id);
        else await registrar.enable(request);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new Error("Push renewal or cleanup pending");
  };
  return {
    push,
    registrar,
    async enable(account) {
      await registrar.enable(await registrationRequest(account));
    },
    resume() {
      resuming ??= resume().finally(() => {
        resuming = undefined;
      });
      return resuming;
    },
  };
}

export interface PushDestination {
  accountId: string | null;
  route: string;
}

/** Native routes are aliases; require a live saved topic before crossing to its account. */
export async function consumePushDestination(
  runtime: PushRuntime,
  accounts: AccountsContextValue,
): Promise<PushDestination | null> {
  const launch = await runtime.push.consumeLaunchRoute();
  if (!launch) return null;
  const fallback = { accountId: null, route: "/notifications" };
  if (!launch.registrationId || !isPushRoute(launch.route)) return fallback;
  const state = await runtime.registrar.snapshot();
  const registration = state.registrations.find(
    (entry) => entry.registrationId === launch.registrationId && !entry.removing,
  );
  if (!registration || !signedIn(accounts, registration.accountId)) return fallback;
  if (!registration.requestedTopics.some((topic) => topic.enabled && topic.route === launch.route))
    return fallback;
  return {
    accountId: registration.accountId,
    route: launch.route.startsWith("/chat/") ? `/chat/r/${launch.route.slice(6)}` : launch.route,
  };
}
