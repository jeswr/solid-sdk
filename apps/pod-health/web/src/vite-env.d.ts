// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Home provider shown first in the shared sign-in card. */
  readonly VITE_HOME_IDP?: string;
  readonly VITE_HOME_IDP_NAME?: string;
  /** Comma-separated HTTPS provider URLs; defaults to the shared directory. */
  readonly VITE_KNOWN_PROVIDERS?: string;
  /** Mirror of APP_ORIGIN for UI labelling; the client_id is derived at runtime
   *  from the actual window origin. */
  readonly VITE_APP_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The build version (short git SHA, else package version) injected by Vite's
 * `define` at build time — see vite.config.ts. Used as the header
 * FeedbackButton's `appVersion` so a filed issue pins the deployed commit. In
 * the test environment vitest provides it via the same `define`.
 */
declare const __APP_VERSION__: string;
