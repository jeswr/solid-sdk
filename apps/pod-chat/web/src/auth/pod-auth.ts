// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});

// Exact stores used before pod-auth; preserve theme and other applications' data.
export const legacyCredentials = {
  indexedDb: ["pod-chat:sessions"],
  localStorage: ["pod-chat:remembered-account"],
  sessionStorage: ["pod-chat:autologin-attempted", "pod-chat:pss.autologin.flow"],
} satisfies LegacyKeys;
