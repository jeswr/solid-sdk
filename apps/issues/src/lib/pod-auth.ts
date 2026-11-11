// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const APP_NAME = "Solid Issues";
export const DEV = process.env.NODE_ENV === "development";
export const legacyCredentials: LegacyKeys = {
  indexedDb: ["solid-issues-auth"],
  localStorage: ["solid:recent-accounts"],
  sessionStorage: ["solid-issues.autologin.flow", "solid-issues.autologin-attempted"],
};

/** One lazy core: browser URLs resolve on first use, after mount, never during prerender. */
export const getPodAuth = createAppPodAuth({
  base: "/",
  dev: DEV,
  // CSS notifications live beside pod folders, on the verified storage server.
  boundary: { storageEndpoints: ["/.notifications/"] },
});
