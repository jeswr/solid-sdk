// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const APP_NAME = "App Store";
// Exact stores written before the pod-auth migration; preserve theme and catalog preferences.
export const LEGACY_CREDENTIALS: LegacyKeys = {
  indexedDb: ["solid-app-store:sessions"],
  localStorage: ["solid-app-store:remembered-account"],
  sessionStorage: ["app-store:pss.autologin.flow", "app-store:autologin-attempted"],
};

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});
