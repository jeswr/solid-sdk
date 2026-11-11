<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Shell session retirement

The Solid backend retains the accepted pod-auth Identity, including its public `grantId`,
beside the shell account. Rejected identities, expired-session cleanup and sign-out pass
that snapshot to `retireIfOwnedBy`; ownership checks and credential cleanup remain in pod-auth.

Reauthentication blocks on `owner-changed` and `grant-changed`, preserving the other tab's
grant. On `missing-grant` or `no-grant`, login can continue when `remembered()` is empty or
matches the expired snapshot's WebID and issuer. A different remembered legacy account
still blocks login. This permits recovery after cold restore drops a missing credential
and after another tab signs out. Missing grant metadata produces a warning; ownership
changes produce an informational diagnostic.

After an explicit sign-out retirement attempt, this tab always clears its account, identity
and restore promise, advances both session counters and aborts any sign-in attempt, including
when retirement skips or throws. Automatic restore stays suppressed in this backend until
an explicit sign-in succeeds. A skip leaves shared credentials untouched and returns a notice
that the accounts provider displays through the shell's toast mechanism: a session in another
tab may remain active. Existing fetch handles and delayed restore or sign-in results cannot
revive the removed shell session.

The policy for explicitly signing out a remembered row without an accepted Identity snapshot
is unchanged: the backend passes the row's WebID and issuer to pod-auth without inventing a
grant ID. Pod-auth retains responsibility for deciding whether those fields authorize
retirement of a matching stored owner. This change neither adds nor removes that authority;
any change to that policy requires a maintainer decision. In the current pod-auth implementation,
an omitted grant ID returns `missing-grant`.
