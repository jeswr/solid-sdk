// AUTHORED-BY Claude Opus 5.5
import type { CapacitorConfig } from "@capacitor/cli";

/** The deployed suite the WebView loads until a production domain is chosen (DESIGN D2). */
export const DEFAULT_SUITE_URL = "https://solid-suite.vercel.app";
export const APP_ID = "org.jeswr.suite";

// Android uses `adb reverse`; iOS simulators share host loopback. Both see a secure localhost.
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/** Remote loads the deployed suite (DESIGN D2); bundled ships the static export (MOB-P3). */
export type SuiteMode = "remote" | "bundled";

/** The bundled export's local origins: Android serves https://localhost, iOS capacitor://localhost. */
export const BUNDLED_ORIGINS = ["https://localhost", "capacitor://localhost"] as const;

export interface MobileEnv {
  /** "remote" (default) or "bundled". Store builds use bundled (MOB-P3 E10). */
  SUITE_MODE?: string;
  /** Bare https origin of the suite; `http://localhost`-style origins only when `debug`. */
  SUITE_URL?: string;
  /** "1" for debug builds: WebView debugging and loopback dev servers. */
  MOBILE_DEBUG?: string;
}

/** Parses `SUITE_MODE`; anything but the two modes is a build error. */
export function suiteMode(env: MobileEnv): SuiteMode {
  const mode = env.SUITE_MODE ?? "remote";
  if (mode !== "remote" && mode !== "bundled") {
    throw new Error('SUITE_MODE must be "remote" or "bundled"');
  }
  return mode;
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
  return suiteMode(env) === "bundled" ? bundledConfig(env) : remoteConfig(env);
}

/**
 * Bundled mode (MOB-P3 E6): no server.url, so the app's own local origin is the trusted origin.
 * SuiteWebViewClient (Android) and SuiteSchemeHandler (iOS) serve the export from `www-bundled`.
 */
function bundledConfig(env: MobileEnv): CapacitorConfig {
  const remote = remoteConfig({ ...env, SUITE_URL: undefined });
  const debug = env.MOBILE_DEBUG === "1";
  return {
    ...remote,
    webDir: "www-bundled",
    server: { androidScheme: "https", hostname: "localhost", iosScheme: "capacitor" },
    ios: {
      ...remote.ios,
      // App-bound domains name remote hosts; the local scheme needs none (E6).
      limitsNavigationsToAppBoundDomains: false,
      webContentsDebuggingEnabled: debug,
    },
  };
}

function remoteConfig(env: MobileEnv): CapacitorConfig {
  const origin = suiteOrigin(env);
  const debug = env.MOBILE_DEBUG === "1";
  return {
    appId: APP_ID,
    appName: "Solid Suite",
    webDir: "www",
    // Capacitor's "debug" logging prints plugin call arguments and results, which would put
    // SuiteSecureStore refresh tokens in the device log, so no build logs bridge payloads.
    loggingBehavior: "none",
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
