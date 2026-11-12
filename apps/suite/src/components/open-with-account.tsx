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

/**
 * The consent screen for opening a private item shared from another pod. The click is the
 * user's consent: it lets the signed-in account read that one address until sign-out.
 */
export function OpenWithAccount({
  url,
  kind,
  open,
}: {
  url: string;
  /** What is being opened, in words: "spreadsheet", "note". */
  kind: string;
  open: () => Promise<void>;
}) {
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
        If the owner shared this {kind} with you, you can open it with your account. Your sign-in
        will be used for <strong>{place(url)}</strong> only, until you sign out.
      </p>
      <Button onClick={onClick} disabled={busy}>
        {busy ? "Opening…" : "Open with your account"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
