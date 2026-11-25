// AUTHORED-BY Claude Opus 5.5
/**
 * Demo pod identity, kept free of seed imports so Node-side tooling (Playwright helpers)
 * can use it without loading every app's seed module.
 */
export const DEMO_ROOT = "https://alice.demo.pod/";
export const DEMO_WEBID = `${DEMO_ROOT}profile/card#me`;

/**
 * A fictional second demo pod: the friends who share things with the demo user keep them here,
 * outside the demo user's own storage. The browser demo serves it read-only.
 */
export const FRIENDS_ROOT = "https://friends.demo.pod/";
