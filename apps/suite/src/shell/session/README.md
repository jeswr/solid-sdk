<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# Shell session retirement

The Solid backend retains the accepted pod-auth Identity, including its public `grantId`,
beside the shell account. Rejected identities, expired-session cleanup and sign-out pass
that snapshot to `retireIfOwnedBy`; ownership checks and credential cleanup remain in pod-auth.

Reauthentication of an expired account whose snapshot this tab holds blocks on
`owner-changed` and `grant-changed` with `account-active`, preserving the other tab's grant.
On `missing-grant` or `no-grant`, login can continue when `remembered()` is empty or matches
the expired snapshot's WebID and issuer. A different remembered legacy account still blocks
login. This permits recovery after another tab signs out. Missing grant metadata produces a
warning; ownership changes produce an informational diagnostic. An expiry without an
accepted snapshot, such as a cold restore that emits `expired`, holds no account row and has
no grant to retire, so its sign-in uses the no-account gate below.

After an explicit sign-out retirement attempt, this tab always clears its account, identity
and restore promise, advances both session counters and aborts any sign-in attempt, including
when retirement skips or throws. Automatic restore stays suppressed in this backend until
an explicit sign-in succeeds. A skip leaves shared credentials untouched. Only `owner-changed`
and `grant-changed` skips return a notice, which the accounts provider displays once through
the shell's toast mechanism, even when sign-out-all skips several accounts: a session in
another tab may remain active. Existing fetch handles and delayed restore or sign-in results
cannot revive the removed shell session.

A sign-in while this backend holds no account, including after a skipped sign-out or a
snapshot-less expiry (whose pointer may survive), never
calls login over another account's live session, because a new grant would replace that
tab's stored owner. Login proceeds when `remembered()` is empty. A remembered session is
restored and returned without login only when a WebID hint names its WebID exactly. If that
session cannot be restored (pod-auth keeps the pointer after refresh failures other than
`invalid_grant`, such as `invalid_client`), login proceeds only while the pointer is gone or
still names that WebID. The same account then signs in with pod-auth's `reauthorize`, which
authorizes instead of retrying the unusable refresh credential and replaces that grant. An
expiry emitted during that restore does not cancel the sign-in.

Every login carries the `remembered()` result its decision used as `expectRemembered`, including
reauthentication of an expired account (read after its retirement attempt). Pod-auth compares
that pointer and the stored grant owner under its namespace mutation lock immediately before
publishing the new grant and the pointer. If another tab signed in while this tab's popup was
open, pod-auth discards only this attempt's grant and rejects with `OwnershipChangedError`,
which the backend maps to `session-elsewhere`; the other tab's session is untouched.

A provider hint cannot identify the account, so it is refused whenever a session is
remembered, even on a shared issuer: an explicit sign-in never lands in a different account.
These refusals, and a WebID hint for a different remembered account, use the
`session-elsewhere` code rather than `account-active`, because this tab shows no account to
sign out. Its message asks the user to sign in with that account's WebID or sign out in the
other tab.

The policy for explicitly signing out a remembered row without an accepted Identity snapshot
is unchanged: the backend passes the row's WebID and issuer to pod-auth without inventing a
grant ID. Pod-auth retains responsibility for deciding whether those fields authorize
retirement of a matching stored owner. This change neither adds nor removes that authority;
any change to that policy requires a maintainer decision. In the current pod-auth implementation,
an omitted grant ID returns `missing-grant`.
