// AUTHORED-BY Codex GPT-6
/** Shared limits for the helper and its caller. All values are milliseconds. */
export const CALL_TIMEOUT_MS = 15_000;
export const LOCK_WAIT_MS = 20_000;
/** Leave time for atomic grant persistence and releasing the profile lock. */
export const HELPER_PERSIST_RESERVE_MS = 2_000;
export const HELPER_DEADLINE_MS = LOCK_WAIT_MS + CALL_TIMEOUT_MS + HELPER_PERSIST_RESERVE_MS;
/** Includes process startup, protocol output and exit after the helper's own deadline. */
export const HELPER_KILL_TIMEOUT_MS = HELPER_DEADLINE_MS + 3_000;
