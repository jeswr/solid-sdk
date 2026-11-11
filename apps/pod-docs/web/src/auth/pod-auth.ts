// AUTHORED-BY GPT-6.1 Sol
import { allowInsecureLoopback, appUrl, createAppPodAuth } from "@jeswr/app-session";

export const getPodAuth = createAppPodAuth({
  clientId: allowInsecureLoopback(import.meta.env.DEV)
    ? undefined
    : appUrl("clientid.jsonld", import.meta.env.BASE_URL),
  redirectUri: appUrl("callback.html", import.meta.env.BASE_URL),
  dev: import.meta.env.DEV,
});
