// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

// The pre-pod-auth host wrote these exact keys; leave theme and other apps' data intact.
export const legacyCredentials: LegacyKeys = {
  indexedDb: ["pod-money:sessions"],
  localStorage: ["pod-money:remembered-account"],
  sessionStorage: ["pod-money:autologin-attempted", "pod-money:pss.autologin.flow"],
};

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});
