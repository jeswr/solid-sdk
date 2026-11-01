// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label } from "@jeswr/suite-ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSuiteEnvironment } from "@/shell/environment";
import { safeNext } from "@/shell/lib/next";
import { RECENT_PROVIDERS_KEY, recentProviders } from "@/shell/lib/preferences";
import { DemoButton } from "@/shell/public/demo-button";
import { PodExplainer } from "@/shell/public/pod-explainer";
import { useAccounts } from "@/shell/session/accounts-provider";
import { SignInError, type SignInHint } from "@/shell/session/types";

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
function SignIn() {
  const env = useSuiteEnvironment();
  const { signIn } = useAccounts();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [address, setAddress] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      setRecent(recentProviders(localStorage.getItem(RECENT_PROVIDERS_KEY)));
    } catch {
      /* Known providers remain available. */
    }
  }, []);
  const submit = async (hint: SignInHint) => {
    setBusy(true);
    setError("");
    try {
      await signIn(hint);
      router.replace(safeNext(next));
    } catch (cause) {
      if (cause instanceof SignInError) {
        setError(cause.message);
        if (cause.code === "unavailable") {
          const provider = "issuer" in hint ? hint.issuer : hint.webId;
          const updated = recentProviders(JSON.stringify([provider, ...recent]));
          setRecent(updated);
          try {
            localStorage.setItem(RECENT_PROVIDERS_KEY, JSON.stringify(updated));
          } catch {
            /* Memory-only. */
          }
        }
      } else setError("We couldn't sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Sign in to Solid Suite</h1>
      {env.NEXT_PUBLIC_SUITE_IDP && (
        <Button
          disabled={busy}
          onClick={() => void submit({ issuer: env.NEXT_PUBLIC_SUITE_IDP as string })}
        >
          Continue with {env.NEXT_PUBLIC_SUITE_IDP_NAME}
        </Button>
      )}
      <h2 className="shell-public-subtitle">Use a different account</h2>
      <form
        className="shell-public-actions"
        onSubmit={(event) => {
          event.preventDefault();
          const value = address.trim();
          void submit(value.includes("#") ? { webId: value } : { issuer: value });
        }}
      >
        <Label htmlFor="account-address">Your account ID or provider</Label>
        <Input
          id="account-address"
          name="account"
          autoComplete="url"
          list="providers"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setError("");
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "signin-error" : undefined}
        />
        <datalist id="providers">
          {[...new Set([...recent, ...env.NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS])].map((provider) => (
            <option key={provider} value={provider} />
          ))}
        </datalist>
        <Button type="submit" disabled={busy}>
          Continue
        </Button>
      </form>
      {error && (
        <p id="signin-error" role="alert">
          {error}
        </p>
      )}
      <DemoButton next={next} />
      <footer className="shell-public-footer">
        {env.SUITE_TEST_CAPS.selfRegistration === true && (
          <>
            <span>
              New here? <a href="/signup">Create an account</a>
            </span>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <PodExplainer />
      </footer>
    </>
  );
}
