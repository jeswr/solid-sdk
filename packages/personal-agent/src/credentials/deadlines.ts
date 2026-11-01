// AUTHORED-BY Codex GPT-6.1-Sol

/** Shared by the helper and its runner so a valid lock wait + refresh fits the deadline. */
export const PROFILE_LOCK_WAIT_MS = 20_000;
export const PROVIDER_CALL_TIMEOUT_MS = 15_000;
/** Process startup, local reads, atomic grant persistence and response delivery. */
export const HELPER_DEADLINE_MARGIN_MS = 5_000;
export const HELPER_TIMEOUT_MS =
  PROFILE_LOCK_WAIT_MS + PROVIDER_CALL_TIMEOUT_MS + HELPER_DEADLINE_MARGIN_MS;
/** After the deadline, let a cooperative helper finish persisting a rotated refresh token. */
export const HELPER_TERMINATION_GRACE_MS = 2_000;
