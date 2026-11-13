// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const APP_NAME = "Pod Health";
// Names written by the pre-pod-auth SessionProvider and webid-token-provider.
export const LEGACY_CREDENTIALS: LegacyKeys = {
  indexedDb: ["pod-health:sessions"],
  localStorage: ["pod-health:remembered-account"],
  sessionStorage: ["pod-health:pss.autologin.flow", "pod-health:autologin-attempted"],
};

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});
