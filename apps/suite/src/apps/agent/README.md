<!-- AUTHORED-BY Claude Opus 5.5 -->

# Agent app: owner approval keys

Each device the owner approves agent actions from has its own non-extractable P-256 key
(`lib/keys.ts`). The private key stays in that device's IndexedDB. The public key is published
in the owner's WebID profile as a `sec:assertionMethod` Multikey with the id
`#agent-approval-YYYYMMDD-xxxxxxxx`. Approvals, control statements, mandate credentials and the
mandate status list are signed with it, and verifiers accept a signature only while its key is
still in the profile.

## Listing keys (Home, Permissions, "Signing keys")

The profile is public, so it carries no device names: naming a key "Jesse's work laptop" would
publish which devices the owner uses. Rows show the creation date taken from the key id, plus
"This device" for the key selected in local storage and "Another device" for the rest.

## Revoking a key (`lib/key-admin.ts`)

Removing a key from the profile also invalidates everything it signed. Without care, revoking
the key that signed an in-force Halt would let the agent resume. So `revokeApprovalKey`:

1. Refuses when the profile is outside the shared storage, when the key is this device's own,
   when it isn't one of the owner's approval keys, or when this device has no ready key.
2. Reads `control/` and `archive/` with verification, and fails closed if either listing is
   incomplete, if any control can't be read, or if a control signed by the key couldn't be
   checked (its key lookup failed). A control that was never valid, such as a bad signature,
   doesn't block revocation.
3. Refuses while the key has an in-force binding change that both allows and limits the agent
   (for example connecting an account while turning sending off). Re-signing it would carry the
   permissive part forward, and letting it lapse would drop the restrictive part. Binding changes
   expire within a day.
4. Re-signs, with this device's key, every verified, owner-attributed, in-force control that
   the revoked key signed and that can only restrict the agent: Halt, RevokeMandate, Archive,
   and a SetBindingState that disables or disconnects an account or turns actions off. Each
   copy keeps the original claims, including the creation time, so ordering is unchanged. Its
   id is `<original>.resigned-<uuid>.trig`, which names the original.
5. Verifies each copy against the current profile before storing it, and stops at the first
   failure.
6. Re-signs the permission status list (`mandates/status.ttl`) when the revoked key signed it,
   keeping every revocation bit and its validity window, and checks the copy verifies. Without
   this, the list would stop verifying and no device could grant permissions again. If the
   check or the profile edit then fails because another device removed this device's key
   meanwhile (two devices revoking each other), the previous list is put back, conditionally
   and only while it is still this device's copy, so the list stays signed by a listed key.
7. Edits the profile only after all of that. Every conditional write, including a retry after
   a conflict, refuses unless this device's key is still listed in the version being edited, so
   two devices revoking each other can't leave the profile without a key.
8. Confirms the removal with a fresh read of the profile. A failed read is reported as
   unconfirmed, not as success.

Permissive controls signed by the revoked key (Resume, a reconnect, turning an action on) are
not re-signed. A key is often revoked because a device was lost, and re-signing would turn
whatever that key signed into a statement trusted under this device's key. They lapse instead,
which can only leave the agent more restricted. The confirmation dialog states how many lapse,
and whether the current mandate was signed with the key (the agent then stops until the
permissions are granted again).

A signed removal record, which would let verifiers keep honouring statements made before the
removal, is tracked as a follow-up bead rather than built here.
