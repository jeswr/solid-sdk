import type { ChallengeContext } from "./challenge.js"

/**
 * Computes the cache key for a request. The default, {@link requestUrlKey}, never shares entries between
 * resources; {@link storageContextKey} shares them within a verified storage.
 */
export type ContextKey = (request: Request, challenge?: ChallengeContext) => Promise<string>

export const requestUrlKey: ContextKey = async request => request.url
