// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";

export const APP_NAME = "Coeliac Diary";
export const DEV = process.env.NODE_ENV === "development";
// The old LoginController's dbName, rememberedAccountsKey and recentAccountsKey.
export const LEGACY_CREDENTIALS: LegacyKeys = {
  indexedDb: ["coeliac-diary-session"],
  localStorage: ["coeliac-diary:last-account", "coeliac-diary:accounts"],
};

/** One lazy core across every route; URLs resolve on first use, after mount. */
export const getPodAuth = createAppPodAuth({ base: "/", dev: DEV });
