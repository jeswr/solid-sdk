// AUTHORED-BY Claude Opus 5.5
/**
 * Demo pod identity, kept free of seed imports so Node-side tooling (Playwright helpers)
 * can use it without loading every app's seed module.
 */
export const DEMO_ROOT = "https://alice.demo.pod/";
export const DEMO_WEBID = `${DEMO_ROOT}profile/card#me`;
