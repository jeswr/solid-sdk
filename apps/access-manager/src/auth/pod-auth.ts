// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const APP_NAME = "Solid Access Manager";

// The former controller.ts passed exactly these names to solid-elements/auth.
export const legacyCredentials: LegacyKeys = {
  localStorage: ["solid-access-manager.remembered-account", "solid-access-manager.recent-accounts"],
  indexedDb: ["solid-access-manager:sessions"],
};

const clientId = import.meta.env.VITE_CLIENT_ID;
export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
  ...(clientId ? { clientId } : {}),
});
