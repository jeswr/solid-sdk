<!-- AUTHORED-BY Codex GPT-6 -->

# Allow the ODI Workspace account to use Gmail

A-026 reuses `@jeswr/agent-channels/gmail` and its executor-only `gmail/send`
binding. The A-036 registry importer corrects ODI email to `google_workspace`;
ODI Teams remains `microsoft`.

## Identify the block

Configure both Gmail factories with `tenant: "ODI"`. An explicit
`admin_policy_enforced` refusal produces a `GmailSetupRequiredError` with
`state: "setup-required"`, `code: "admin_policy_enforced"`, and
`detail: "ask ODI admin to allow-list client id"`.
Google documents this as a Workspace policy block. An `access_denied` refusal
also requires setup, but calls for reviewing consent for the configured account;
it alone does not establish that an administrator blocked the app.
See [Google's OAuth error guidance](https://developers.google.com/identity/protocols/oauth2/native-app#errors).

Ask the operator for the full OAuth client ID used by this account's configured
read grant, plus the send grant's client ID if different. Obtain these from the
configured app's Google Cloud **Google Auth platform → Clients** entry. Supply
the public client IDs and required scope list to ODI IT; never supply client
secrets, tokens, authorization codes, or credential-store contents.

The existing binding uses distinct grants:

| Grant | Scope |
| --- | --- |
| Reader | `https://www.googleapis.com/auth/gmail.readonly` |
| Executor send, only if enabled by the owner | `https://www.googleapis.com/auth/gmail.send` |

## ODI administrator steps

1. Sign in at [Google Admin console](https://admin.google.com/) with ODI's
   **Service Settings** administrator privilege.
2. Open **Security → Access and data control → API controls → Manage App Access**.
3. Under **Configured apps**, choose **Configure new app**. Search by the full
   OAuth client ID and select the matching app.
4. In **Scope**, choose **Select org units → Include organizations**, select
   the unit containing the ODI account, then **Select → Continue**.
5. Under **Access to Google data**, choose **Specific Google data** and select
   the approved scopes above, plus any Google Sign-in scopes the configured app
   requests. **Trusted** allows all scopes; use it only if ODI IT approves that
   broader access. Keep Context-Aware Access exemptions off.
6. Choose **Continue**, review the client, organizational scope and permissions,
   then **Finish**. Repeat for a distinct send client ID if approved.

For an existing entry, open the app's **Access to Google data** section, select
the account's organizational unit, update its access level, and **Save**.
These steps follow [Google's app access control instructions](https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data?hl=en).

## Verify and recover

After ODI IT confirms the change, rerun the normal consent flow for the intended
ODI account and read grant. Keep the account in `setup-required` until a read
succeeds; allow-listing alone does not prove connectivity. If the block remains,
have IT check the exact client ID, account organizational unit and approved scopes.
Review generic `access_denied` with the user before assuming an admin policy issue.

Provision send consent separately if needed. Allow-listing grants no owner approval
to transmit: dry-run, exact signed MIME, configured sender, send credentials and
executor approval checks still apply. Never retry an uncertain send on the strength
of an admin change; reconcile it through provider-copy lookup. Tests use only fakes.
