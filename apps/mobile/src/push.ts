// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { registerPlugin } from "@capacitor/core";

export interface PushTopic {
  index: number;
  kind: "inbox" | "chat";
  label: string;
  route: string;
  enabled: boolean;
}

export interface PushLaunchRoute {
  registrationId: string | null;
  route: string;
}

export interface SuitePushPlugin {
  status(): Promise<{
    permission: "granted" | "denied" | "prompt";
    installed: boolean;
    platform: "android" | "ios";
    /** An enabled installation needs a relay token update and activation on the next launch/resume. */
    registrationStale: boolean;
  }>;
  enable(): Promise<{
    pushToken: string;
    devicePublicKey: string;
    authSecret: string;
    deviceSigningKey: { kty: "EC"; crv: "P-256"; x: string; y: string };
  }>;
  setTopicMap(options: {
    registrationId: string;
    topics: PushTopic[];
    /** Include only after this token's relay activation is confirmed. Rejects if it rotated again. */
    pushToken?: string;
  }): Promise<void>;
  silence(options: { registrationId: string }): Promise<void>;
  /** Exact UTF-8 body sent to the relay; url has no query. Native code supplies iat, body hash and a fresh jti. */
  sign(request: { method: string; url: string; body?: string }): Promise<{ proof: string }>;
  activate(options: { installationId: string }): Promise<{ nonce: string }>;
  /** Default: silence all and retain keys. Delete only after the registrar confirms relay cleanup. */
  disable(options?: { deleteLocalData?: boolean }): Promise<void>;
  consumeLaunchRoute(): Promise<PushLaunchRoute | null>;
}

// Capacitor's native resolve APIs carry objects. Unwrap the nullable result at this local binding.
interface NativeSuitePush extends Omit<SuitePushPlugin, "consumeLaunchRoute"> {
  consumeLaunchRoute(): Promise<{ launchRoute: PushLaunchRoute | null }>;
}
const native = registerPlugin<NativeSuitePush>("SuitePush");

export const SuitePush: SuitePushPlugin = {
  status: () => native.status(),
  enable: () => native.enable(),
  setTopicMap: (options) => native.setTopicMap(options),
  silence: (options) => native.silence(options),
  sign: (request) => native.sign(request),
  activate: (options) => native.activate(options),
  disable: (options) => native.disable(options),
  consumeLaunchRoute: async () => (await native.consumeLaunchRoute()).launchRoute,
};
