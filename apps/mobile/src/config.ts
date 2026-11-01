// AUTHORED-BY Claude Opus 5.5
import type { CapacitorConfig } from "@capacitor/cli";

/** The deployed suite the WebView loads until a production domain is chosen (DESIGN D2). */
export const DEFAULT_SUITE_URL = "https://solid-suite.vercel.app";
export const APP_ID = "org.jeswr.suite";

// Emulators reach host servers through `adb reverse`, so the WebView sees a secure localhost.
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export interface MobileEnv {
  /** Bare https origin of the suite; `http://localhost`-style origins only when `debug`. */
  SUITE_URL?: string;
  /** "1" for debug builds: WebView debugging and loopback dev servers. */
  MOBILE_DEBUG?: string;
}

/** Parses and checks `SUITE_URL`; returns the origin the shell is locked to. */
export function suiteOrigin(env: MobileEnv): URL {
  const debug = env.MOBILE_DEBUG === "1";
  const url = new URL(env.SUITE_URL ?? DEFAULT_SUITE_URL);
  const loopback = debug && url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("SUITE_URL must be https (http only for loopback with MOBILE_DEBUG=1)");
  }
  if (url.href !== `${url.origin}/` || url.username !== "" || url.password !== "") {
    throw new Error("SUITE_URL must be a bare origin");
  }
  return url;
}

/** The Capacitor configuration for one build, derived from one trusted origin (DESIGN D2, D9). */
export function mobileConfig(env: MobileEnv): CapacitorConfig {
  const origin = suiteOrigin(env);
  const debug = env.MOBILE_DEBUG === "1";
  return {
    appId: APP_ID,
    appName: "Solid Suite",
    webDir: "www",
    loggingBehavior: debug ? "debug" : "none",
    server: {
      url: origin.origin,
      // No allowNavigation: the server origin is the only in-app origin, enforced exactly by
      // SuiteWebViewClient / SuiteNavigationPlugin (Capacitor's own checks are host-only, and
      // its Android origin-rule conversion mis-handles hostnames that start with "http").
      errorPath: "offline.html",
      cleartext: origin.protocol === "http:",
      androidScheme: "https",
    },
    android: {
      allowMixedContent: false,
      webContentsDebuggingEnabled: debug,
      useLegacyBridge: false,
    },
    ios: {
      // @capacitor/share stays out of the iOS binary: Capacitor instantiates any linked plugin class a
      // page names, which would let it replace SuiteSharePlugin's staged-files-only "Share".
      includePlugins: ["@capacitor/app"],
      limitsNavigationsToAppBoundDomains: true,
      webContentsDebuggingEnabled: debug,
      contentInset: "automatic",
    },
  };
}
