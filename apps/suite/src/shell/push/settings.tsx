// AUTHORED-BY Codex GPT-6
"use client";
import { Button } from "@jeswr/suite-ui";
import { useAccounts } from "../session/accounts-context";
import { RequiresOnline } from "../sync/requires-online";
import { useNativePush } from "./provider";
import { signedIn } from "./runtime";

export function NativePushSettings() {
  const push = useNativePush();
  const accounts = useAccounts();
  if (!push) return null;
  return (
    <section aria-labelledby="native-push-heading">
      <h2 id="native-push-heading">Push notifications</h2>
      <p>Notifications pause if you don't open Solid Suite for a week</p>
      <p>Solid Suite will remind you to open it one day before your pod subscriptions expire.</p>
      <p role="status">Permission: {push.status?.permission ?? "Checking…"}</p>
      {push.status?.permission === "denied" && (
        <p>Allow notifications in your phone settings, then try again.</p>
      )}
      {accounts.accounts.map((account) => {
        const registrations =
          push.state?.registrations.filter((entry) => entry.accountId === account.id) ?? [];
        const enabled = registrations.some((entry) => !entry.removing && entry.topics.length > 0);
        const removing = registrations.some((entry) => entry.removing);
        const busy = push.busy.has(account.id);
        const available = account.kind === "solid" && signedIn(accounts, account.id);
        const expiries = registrations
          .filter((entry) => !entry.removing)
          .flatMap((entry) => entry.topics.map((topic) => topic.expiresAt));
        const expiry = expiries.length ? Math.min(...expiries) : null;
        return (
          <div key={account.id}>
            <h3>{account.name}</h3>
            <p role="status">
              {busy
                ? "Updating…"
                : removing
                  ? "Off · cleanup pending"
                  : enabled
                    ? expiry && expiry <= Date.now()
                      ? "Paused · open to renew"
                      : "On"
                    : "Off"}
            </p>
            {expiry !== null && (
              <p>Pod subscriptions expire {new Date(expiry).toLocaleString()}.</p>
            )}
            {enabled || removing ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void push.setEnabled(account, false);
                }}
              >
                Turn off notifications for {account.name}
              </Button>
            ) : (
              <RequiresOnline>
                <Button
                  variant="outline"
                  disabled={busy || !available || push.status?.permission === "denied"}
                  onClick={() => {
                    void push.setEnabled(account, true);
                  }}
                >
                  Turn on notifications for {account.name}
                </Button>
              </RequiresOnline>
            )}
            {available && (push.errors[account.id] || enabled) && (
              <RequiresOnline>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void push.setEnabled(account, true);
                  }}
                >
                  Try again for {account.name}
                </Button>
              </RequiresOnline>
            )}
            {!available && <p>Sign in with a Solid account to enable push notifications.</p>}
            {push.errors[account.id] && <p role="alert">{push.errors[account.id]}</p>}
          </div>
        );
      })}
      {push.errors.system && <p role="alert">{push.errors.system}</p>}
    </section>
  );
}
