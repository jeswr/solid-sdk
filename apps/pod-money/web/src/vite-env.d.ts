// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Display hint: the suite's HOME identity provider. The auth issuer always
   *  comes from the WebID profile, so this is non-load-bearing for login. */
  readonly VITE_HOME_IDP?: string;
  /** Mirror of APP_ORIGIN for UI labelling; the client_id is derived at runtime
   *  from the actual window origin. */
  readonly VITE_APP_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The build version (short git SHA, or the package version as a fallback),
 * injected at build time by Vite's `define` (see vite.config.ts). Read by the
 * header <FeedbackButton appVersion={__APP_VERSION__} /> so a filed issue pins
 * the exact deployed commit. A compile-time string literal — no runtime access.
 */
declare const __APP_VERSION__: string;
