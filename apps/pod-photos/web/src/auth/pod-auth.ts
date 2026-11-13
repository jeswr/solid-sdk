// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});

// Before pod-auth, SessionProvider wrote the refresh store, account pointer and loop guard;
// WebIdDPoPTokenProvider wrote the full-page flow. Keep other apps' keys and our theme.
export const legacyCredentials: LegacyKeys = {
  indexedDb: ["pod-photos:sessions"],
  localStorage: ["pod-photos:remembered-account"],
  sessionStorage: ["pod-photos:pss.autologin.flow", "pod-photos:autologin-attempted"],
};
