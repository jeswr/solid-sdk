// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * /signin (02-suite-shell §8.1) on the suite-ui SignInCard: Account ID first,
 * then provider buttons (home provider first), another provider, and the
 * accounts used on this device. Until pod-auth's provider directory lands,
 * input is mapped to a WebID hint when it names a document, else an issuer.
 */
import { Button } from "@jeswr/suite-ui";
import {
  hostOf,
  SignInCard,
  type SignInProvider,
  type SignInRecentAccount,
} from "@jeswr/suite-ui/sign-in";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSolidExtension } from "@/lib/session/extension-session";
import { useSuiteEnvironment } from "@/shell/environment";
import { safeNext } from "@/shell/lib/next";
import { RECENT_PROVIDERS_KEY, recentProviders } from "@/shell/lib/preferences";
import { hintForField, rememberedIssuer } from "@/shell/lib/sign-in-hint";
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

type Pending = { kind: "webid" | "provider" | "account" | "custom"; key: string } | null;

function SignIn() {
  const env = useSuiteEnvironment();
  const { signIn, signInWith, backendKinds, accounts, active } = useAccounts();
  const extension = useSolidExtension();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const adding = params.get("add") === "1" && active;
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  useEffect(() => {
    try {
      setRecent(recentProviders(localStorage.getItem(RECENT_PROVIDERS_KEY)));
    } catch {
      /* Known providers remain available. */
    }
  }, []);
  const providers = useMemo<SignInProvider[]>(() => {
    const issuers = [
      ...(env.NEXT_PUBLIC_SUITE_IDP ? [env.NEXT_PUBLIC_SUITE_IDP] : []),
      ...env.NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS,
    ];
    return [...new Set(issuers)].map((issuer, index) => ({
      id: issuer,
      issuer,
      name:
        index === 0 && env.NEXT_PUBLIC_SUITE_IDP ? env.NEXT_PUBLIC_SUITE_IDP_NAME : hostOf(issuer),
    }));
  }, [env]);
  const recentAccounts: SignInRecentAccount[] = accounts
    .filter((account) => account.kind === "solid" && account.id !== active?.id)
    .map((account) => ({
      webId: account.webId,
      name: account.name,
      ...(account.photoUrl ? { photoUrl: account.photoUrl } : {}),
    }));
  const remember = (provider: string) => {
    const updated = recentProviders(JSON.stringify([provider, ...recent]));
    setRecent(updated);
    try {
      localStorage.setItem(RECENT_PROVIDERS_KEY, JSON.stringify(updated));
    } catch {
      /* Memory-only. */
    }
  };
  const submit = async (hint: SignInHint, state: NonNullable<Pending>) => {
    setPending(state);
    setError(null);
    try {
      await signIn(hint);
      router.replace(safeNext(next));
    } catch (cause) {
      if (cause instanceof SignInError) {
        setError(cause.message);
        const issuer = rememberedIssuer(hint);
        if (cause.code === "unavailable" && issuer) remember(issuer);
      } else setError("We couldn't sign you in. Please try again.");
    } finally {
      setPending(null);
    }
  };
  const useExtension = extension.present && backendKinds.includes("extension");
  return (
    <>
      <h1 className="suite-sr-only">Sign in to Solid Suite</h1>
      {adding && (
        <p role="status" className="shell-public-note">
          Adding another account — you stay signed in as {active.name}.
        </p>
      )}
      <SignInCard
        title="Sign in to Solid Suite"
        subtitle="Use your Account ID, or choose where your account lives."
        providers={providers}
        recentProviders={recent}
        recentAccounts={recentAccounts}
        pending={pending}
        error={error}
        onWebId={(input) =>
          void submit(hintForField("webid", input), { kind: "webid", key: input })
        }
        onCustomProvider={(input) =>
          void submit(hintForField("provider", input), { kind: "custom", key: input })
        }
        onProvider={(provider) =>
          void submit({ issuer: provider.issuer }, { kind: "provider", key: provider.id })
        }
        onAccount={(account) =>
          void submit({ webId: account.webId }, { kind: "account", key: account.webId })
        }
        footer={
          <div className="shell-public-actions">
            {useExtension && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await signInWith("extension", { webId: extension.webId ?? "" });
                    router.replace(safeNext(next));
                  } catch {
                    setError("The Solid browser extension didn't sign you in. Please try again.");
                  }
                }}
              >
                Use the Solid extension
              </Button>
            )}
            <DemoButton next={next} />
            <p className="shell-public-footer">
              {env.SUITE_TEST_CAPS.selfRegistration === true && (
                <>
                  <span>
                    New here? <a href="/signup">Create an account</a>
                  </span>
                  <span aria-hidden="true"> · </span>
                </>
              )}
              <PodExplainer />
            </p>
          </div>
        }
      />
    </>
  );
}
