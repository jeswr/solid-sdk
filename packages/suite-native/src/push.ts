// AUTHORED-BY Codex GPT-6
import {
  isPushRoute,
  pushBytes,
  pushId,
  pushInteger,
  pushObject,
  pushString,
  pushUrl,
  requirePush,
} from "./push-validation.js";

export type {
  BoundPushTopic,
  PushRegistrar,
  PushRegistrarOptions,
  PushRegistrarState,
  PushRegistration,
  PushRegistrationRequest,
  PushSubscriptionRequest,
  PushSubscriptions,
  PushTopicSpec,
} from "./push-registrar.js";
export { createPushRegistrar } from "./push-registrar.js";
export { isPushRoute } from "./push-validation.js";

export interface PushTopic {
  index: number;
  kind: "inbox" | "chat";
  label: string;
  route: string;
  enabled: boolean;
}
export interface PushStatus {
  permission: "granted" | "denied" | "prompt";
  installed: boolean;
  platform: "android" | "ios";
  registrationStale: boolean;
}
export interface PushKeys {
  pushToken: string;
  devicePublicKey: string;
  authSecret: string;
  deviceSigningKey: { kty: "EC"; crv: "P-256"; x: string; y: string };
}
export interface PushLaunchRoute {
  registrationId: string | null;
  route: string;
}
export interface PushTopicMap {
  registrationId: string;
  topics: PushTopic[];
  pushToken?: string;
}
export interface PushSignRequest {
  method: string;
  url: string;
  body?: string;
}
/** Raw Capacitor contract. Import its binding from ./capacitor only inside the native app. */
export interface NativePushPlugin {
  status(): Promise<PushStatus>;
  enable(): Promise<PushKeys>;
  setTopicMap(options: PushTopicMap): Promise<void>;
  silence(options: { registrationId: string }): Promise<void>;
  sign(options: PushSignRequest): Promise<{ proof: string }>;
  activate(options: { installationId: string }): Promise<{ nonce: string }>;
  disable(options?: { deleteLocalData?: boolean }): Promise<void>;
  scheduleRenewalReminder(options: { expiresAt: number | null }): Promise<void>;
  consumeLaunchRoute(): Promise<{ launchRoute: PushLaunchRoute | null }>;
}
export interface PushClient extends Omit<NativePushPlugin, "consumeLaunchRoute"> {
  consumeLaunchRoute(): Promise<PushLaunchRoute | null>;
}

export function validatePushTopic(value: unknown): asserts value is PushTopic {
  const topic = pushObject(value, ["index", "kind", "label", "route", "enabled"]);
  pushInteger(topic.index);
  requirePush(topic.index <= 15);
  requirePush(topic.kind === "inbox" || topic.kind === "chat");
  pushString(topic.label, 160);
  requirePush(isPushRoute(topic.route));
  requirePush(typeof topic.enabled === "boolean");
}

/** Validate both sides of the guarded native bridge; never expose native error text. */
export function createPush(plugin: NativePushPlugin): PushClient {
  async function invoke<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new Error("Push operation failed");
    }
  }
  return {
    status: () =>
      invoke(async () => {
        const value = pushObject(await plugin.status(), [
          "permission",
          "installed",
          "platform",
          "registrationStale",
        ]);
        requirePush(
          value.permission === "granted" ||
            value.permission === "denied" ||
            value.permission === "prompt",
        );
        requirePush(
          typeof value.installed === "boolean" && typeof value.registrationStale === "boolean",
        );
        requirePush(value.platform === "android" || value.platform === "ios");
        return value as unknown as PushStatus;
      }),
    enable: () =>
      invoke(async () => {
        const keys = pushObject(await plugin.enable(), [
          "pushToken",
          "devicePublicKey",
          "authSecret",
          "deviceSigningKey",
        ]);
        pushString(keys.pushToken);
        const point = pushBytes(keys.devicePublicKey, 65);
        requirePush(point[0] === 4);
        await crypto.subtle.importKey(
          "raw",
          point as Uint8Array<ArrayBuffer>,
          { name: "ECDH", namedCurve: "P-256" },
          false,
          [],
        );
        pushBytes(keys.authSecret, 16);
        const key = pushObject(keys.deviceSigningKey, ["kty", "crv", "x", "y"]);
        requirePush(key.kty === "EC" && key.crv === "P-256");
        pushBytes(key.x, 32);
        pushBytes(key.y, 32);
        await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, [
          "verify",
        ]);
        return keys as unknown as PushKeys;
      }),
    async setTopicMap(options) {
      const value = pushObject(options, ["registrationId", "topics", "pushToken"]);
      pushId(value.registrationId);
      requirePush(Array.isArray(value.topics) && value.topics.length <= 16);
      const seen = new Set<number>();
      for (const topic of value.topics) {
        validatePushTopic(topic);
        requirePush(!seen.has(topic.index));
        seen.add(topic.index);
      }
      if (value.pushToken !== undefined) pushString(value.pushToken);
      await invoke(() => plugin.setTopicMap(structuredClone(options)));
    },
    async silence(options) {
      const value = pushObject(options, ["registrationId"]);
      pushId(value.registrationId);
      await invoke(() => plugin.silence({ registrationId: value.registrationId as string }));
    },
    async sign(options) {
      const value = pushObject(options, ["method", "url", "body"]);
      requirePush(["POST", "PATCH", "PUT", "DELETE"].includes(value.method as string));
      const url = pushUrl(value.url);
      requirePush((value.url as string).length <= 2048);
      requirePush(!new URL(url).search);
      requirePush(
        value.body === undefined ||
          (typeof value.body === "string" && new TextEncoder().encode(value.body).length <= 65_536),
      );
      return invoke(async () => {
        const result = pushObject(await plugin.sign(structuredClone(options)), ["proof"]);
        pushString(result.proof);
        requirePush(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/u.test(result.proof));
        pushBytes(result.proof.split(".")[2], 64);
        return { proof: result.proof };
      });
    },
    async activate(options) {
      const value = pushObject(options, ["installationId"]);
      pushId(value.installationId);
      return invoke(async () => {
        const result = pushObject(
          await plugin.activate({ installationId: value.installationId as string }),
          ["nonce"],
        );
        pushBytes(result.nonce, 16);
        return { nonce: result.nonce as string };
      });
    },
    async disable(options = {}) {
      const value = pushObject(options, ["deleteLocalData"]);
      requirePush(
        value.deleteLocalData === undefined || typeof value.deleteLocalData === "boolean",
      );
      await invoke(() => plugin.disable(structuredClone(options)));
    },
    async scheduleRenewalReminder(options) {
      const value = pushObject(options, ["expiresAt"]);
      if (value.expiresAt !== null) {
        pushInteger(value.expiresAt);
        requirePush(value.expiresAt > Date.now());
      }
      await invoke(() =>
        plugin.scheduleRenewalReminder({ expiresAt: value.expiresAt as number | null }),
      );
    },
    consumeLaunchRoute: () =>
      invoke(async () => {
        const result = pushObject(await plugin.consumeLaunchRoute(), ["launchRoute"]);
        if (result.launchRoute === null) return null;
        const route = pushObject(result.launchRoute, ["registrationId", "route"]);
        if (route.registrationId !== null) pushId(route.registrationId);
        requirePush(isPushRoute(route.route));
        requirePush(route.registrationId !== null || route.route === "/notifications");
        return route as unknown as PushLaunchRoute;
      }),
  };
}
