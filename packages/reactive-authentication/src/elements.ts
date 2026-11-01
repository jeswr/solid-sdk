/**
 * Browser-only custom element classes. They extend `HTMLElement`, so this module can only be imported where
 * the DOM exists; the main entry point stays importable in Node.js, SSR and workers.
 *
 * @module
 */
export * from "./AuthorizationCodeFlow.js";
export * from "./IdpPicker.js";
export * from "./WebIdPicker.js";
