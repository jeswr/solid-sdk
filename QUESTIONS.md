<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-10 conservative readings

1. DESIGN §3/§5 names revoke cascades without specifying shared-session granularity.
   Options: revoke one MCP grant only; retire the pod session and reject all bound grants.
   Implemented: retire the pod session on MCP revocation or credential reuse. The broker's
   durable liveness check makes every bound MCP grant unusable, including existing access tokens.
   No remote issuer revocation endpoint is required by the spec; retirement destroys local secrets.
2. DESIGN §3 accepts a WebID or issuer without a discriminator.
   Options: guess from URL shape; attempt issuer discovery then resolve the WebID profile on
   discovery HTTP 404 only. Implemented: the latter, with no fallback on malformed metadata,
   issuer mismatch or transport failures. The authenticated WebID must advertise the selected
   issuer in its own profile before a pod session is accepted.
3. DESIGN §3 specifies put/get/delete but not concurrent refresh or crash recovery.
   Options: allow overlapping refreshes; claim refresh ownership atomically and fail closed.
   Implemented: ciphertext-store CAS, permanently retired IDs, and a durable refresh claim.
   An interrupted claimed refresh requires a new login; file lock files left by a process crash
   require operator cleanup while the store is offline. No lease expiry risks duplicate redemption.
