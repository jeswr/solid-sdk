// AUTHORED-BY Claude Fable 5
//
// Wire the suite auth stack (the @jeswr/solid-elements /auth adapter over
// @solid/reactive-authentication + @jeswr/solid-session-restore) into the
// LoginController seam <jeswr-login-panel> drives. BROWSER-ONLY — imported
// from main.tsx, never from the data layer (which stays fetch-injectable and
// unit-testable without any of this).

import "@solid/reactive-authentication/registerElements"; // registers <authorization-code-flow>
import type { LoginController } from "@jeswr/solid-elements";
import { createReactiveAuthController } from "@jeswr/solid-elements/auth";

/** Unique-per-app keys on a shared origin (the /auth subexport contract). */
const DB_NAME = "solid-access-manager:sessions";
const REMEMBERED_KEY = "solid-access-manager.remembered-account";
const RECENT_KEY = "solid-access-manager.recent-accounts";

/** Ensure the popup driver element exists, then build the controller. */
export function buildController(): LoginController {
  let authFlow = document.querySelector("authorization-code-flow");
  if (!authFlow) {
    authFlow = document.createElement("authorization-code-flow");
    document.body.append(authFlow);
  }
  const clientId = import.meta.env.VITE_CLIENT_ID as string | undefined;
  return createReactiveAuthController({
    // The element implements getCode (the reactive-auth popup contract).
    authFlow: authFlow as unknown as {
      getCode: (uri: URL, signal: AbortSignal) => Promise<string>;
    },
    callbackUri: new URL("/callback.html", location.href).toString(),
    ...(clientId ? { clientId } : {}), // absent → dynamic registration (dev fallback)
    dbName: DB_NAME,
    rememberedAccountsKey: REMEMBERED_KEY,
    recentAccountsKey: RECENT_KEY,
    // Dev CSS over HTTP loopback only; remote issuers stay HTTPS-strict.
    allowInsecureLoopback: import.meta.env.DEV,
  });
}
