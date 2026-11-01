// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { AccountAvatar, AccountCard } from "../account/account-card";
import { useSuiteEnvironment } from "../environment";
import { useAccounts } from "../session/accounts-provider";

export function AccountSettings() {
  const { active, accounts } = useAccounts();
  const { NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL: provider } = useSuiteEnvironment();
  if (!active) return null;
  return (
    <>
      <section aria-label="Your account">
        <AccountCard account={active} />
        <p>Your name and photo are shown as provided by your account.</p>
      </section>
      <section aria-labelledby="settings-storage">
        <h2 id="settings-storage">Your storage</h2>
        <ul>
          <li>
            {new URL(active.storageUrl).host} · <a href="/settings/storage">What it supports</a>
          </li>
        </ul>
      </section>
      {active.kind !== "extension" && (
        <section aria-labelledby="settings-security">
          <h2 id="settings-security">Account security</h2>
          <p>Passkeys and password are managed by your provider.</p>
          {provider && (
            <a href={provider} rel="noopener noreferrer">
              Manage passkeys and password with your provider
            </a>
          )}
        </section>
      )}
      <section aria-labelledby="settings-connected">
        <h2 id="settings-connected">Connected accounts</h2>
        <ul className="settings-account-list">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountAvatar account={account} />
              <span>
                {account.name} · {new URL(account.storageUrl).host}
                {account.id === active.id && " · Active"}
              </span>
            </li>
          ))}
        </ul>
        <a href="/signin?add=1&next=%2Fsettings%2Faccount">Add another account</a>
      </section>
      {active.kind !== "extension" && (
        <section aria-labelledby="settings-delete">
          <h2 id="settings-delete">Delete account</h2>
          <p>Account deletion is managed by your provider.</p>
          {provider ? (
            <a href={provider} rel="noopener noreferrer">
              Delete account with your provider
            </a>
          ) : (
            <p>Visit your provider's account page to request deletion.</p>
          )}
        </section>
      )}
    </>
  );
}
