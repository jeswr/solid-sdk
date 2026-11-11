// AUTHORED-BY Codex GPT-6
import { createApnsTransport } from "./apns.js";
import { createFcmTransport, type FcmOptions } from "./fcm.js";
import { createRelayOutboundFetch } from "./outbound.js";
import { createDeliverySink, type DeliveryOptions } from "./push-delivery.js";

/** Environment parsing never includes a secret value in a startup error. */
export function configuredDelivery(
  env: NodeJS.ProcessEnv,
  onInvalid?: DeliveryOptions["onInvalid"],
  providerFetch?: typeof globalThis.fetch,
) {
  const fcmFields = [env.RELAY_FCM_SERVICE_ACCOUNT, env.RELAY_FCM_PROJECT_ID];
  const apnsFields = [
    env.RELAY_APNS_KEY,
    env.RELAY_APNS_KEY_ID,
    env.RELAY_APNS_TEAM_ID,
    env.RELAY_APNS_BUNDLE_ID,
  ];
  const fcm = fcmFields.some((field) => field !== undefined);
  const apns =
    apnsFields.some((field) => field !== undefined) || env.RELAY_APNS_SANDBOX !== undefined;
  if (
    (fcm && !fcmFields.every(Boolean)) ||
    (apns && !apnsFields.every(Boolean)) ||
    (env.RELAY_APNS_SANDBOX !== undefined && env.RELAY_APNS_SANDBOX !== "1")
  )
    throw new Error("Incomplete push provider configuration");
  if (!fcm && !apns) return undefined;
  try {
    let serviceAccount: FcmOptions["serviceAccount"] | undefined;
    if (fcm) {
      serviceAccount = JSON.parse(env.RELAY_FCM_SERVICE_ACCOUNT as string);
      if (
        !serviceAccount ||
        typeof serviceAccount.client_email !== "string" ||
        typeof serviceAccount.private_key !== "string"
      )
        throw new Error("Invalid service account");
    }
    return createDeliverySink({
      fcm: fcm
        ? createFcmTransport({
            projectId: env.RELAY_FCM_PROJECT_ID as string,
            // Validated above before a transport is constructed.
            serviceAccount: serviceAccount as FcmOptions["serviceAccount"],
            fetch: providerFetch ?? createRelayOutboundFetch(),
          })
        : undefined,
      apns: apns
        ? createApnsTransport({
            key: env.RELAY_APNS_KEY as string,
            keyId: env.RELAY_APNS_KEY_ID as string,
            teamId: env.RELAY_APNS_TEAM_ID as string,
            sandbox: env.RELAY_APNS_SANDBOX === "1",
          })
        : undefined,
      bundleId: env.RELAY_APNS_BUNDLE_ID,
      onInvalid,
    });
  } catch {
    throw new Error("Invalid push provider configuration");
  }
}
