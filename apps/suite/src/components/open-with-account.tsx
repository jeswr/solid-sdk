// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Claude Opus 5.5
"use client";
import { ResourceGrantError } from "@jeswr/pod-auth";
import { Button } from "@jeswr/suite-ui";
import { useState } from "react";

const refusals: Partial<Record<ResourceGrantError["reason"], string>> = {
  "signed-out": "Sign in again, then open it with your account.",
  "no-user-activation": "Click the button again to open it with your account.",
  "own-storage": "This address is in your own storage. Open it from your files instead.",
};

/** A short, readable form of the address the consent covers. */
function place(url: string) {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}

/** Consent for the session to send credentials to the displayed addresses. */
export function OpenWithAccount({
  url,
  kind,
  open,
}: {
  url: string | readonly string[];
  /** What is being opened, in words: "spreadsheet", "note". */
  kind: string;
  open: () => Promise<void>;
}) {
  const addresses = typeof url === "string" ? [url] : url;
  const container = addresses.some((address) => address.endsWith("/"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onClick = () => {
    setBusy(true);
    setError(undefined);
    open().then(
      () => setBusy(false),
      (failure: unknown) => {
        setBusy(false);
        setError(
          (failure instanceof ResourceGrantError && refusals[failure.reason]) ||
            `Couldn't open this ${kind} with your account.`,
        );
      },
    );
  };
  return (
    <section className="open-with-account" aria-label="Open with your account">
      <p>
        Until you sign out of this session, the suite will send your sign-in to the{" "}
        {addresses.length === 1 ? "address" : "addresses"} below to read or change this {kind}
        {container && " and everything inside it"}.
      </p>
      <ul>
        {addresses.map((address) => (
          <li key={address}>
            <strong>{place(address)}</strong>
          </li>
        ))}
      </ul>
      <Button onClick={onClick} disabled={busy}>
        {busy ? "Opening…" : "Open with your account"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
