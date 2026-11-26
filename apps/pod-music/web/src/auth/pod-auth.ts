// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth } from "@jeswr/app-session";

export const APP_NAME = "Pod Music";
// Exact stores selected by Music's pre-pod-auth SessionProvider and redirect provider.
export const legacyCredentials = {
  indexedDb: ["pod-music:sessions"],
  localStorage: ["pod-music:remembered-account"],
  sessionStorage: ["pod-music:pss.autologin.flow", "pod-music:autologin-attempted"],
};

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});
