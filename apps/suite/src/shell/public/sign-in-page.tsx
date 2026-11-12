// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import type { en } from "@jeswr/suite-i18n";
import { useT } from "@jeswr/suite-i18n/react";
/**
 * /signin (02-suite-shell §8.1) on the suite-ui SignInCard: Account ID first,
 * then provider buttons (home provider first), another provider, and the
 * accounts used on this device. The backend resolves addresses through pod-auth
 * while preserving whether the person entered a WebID or a provider.
 */
import { Button } from "@jeswr/suite-ui";
import {
  hostOf,
  SignInCard,
  type SignInProvider,
  type SignInRecentAccount,
} from "@jeswr/suite-ui/sign-in";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSolidExtension } from "@/lib/session/extension-session";
import { preloadAppFrame } from "@/shell/app-frame-loaders";
import { useSuiteEnvironment } from "@/shell/environment";
import { safeNext } from "@/shell/lib/next";
import { RECENT_PROVIDERS_KEY, recentProviders } from "@/shell/lib/preferences";
import { hintForField, rememberedIssuer } from "@/shell/lib/sign-in-hint";
import { DemoButton } from "@/shell/public/demo-button";
import { PodExplainer } from "@/shell/public/pod-explainer";
import {
  SIGNUP_UNAVAILABLE_KEY,
  SIGNUP_UNAVAILABLE_PARAM,
  useRegistration,
} from "@/shell/registration/use-registration";
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
/** A message key, translated at render so a language change re-renders an open error. */
type Failure =
  | `signin.errors.${keyof typeof en.signin.errors}`
  | "signin.failed"
  | "signin.extensionFailed";

function SignIn() {
  const t = useT();
  const env = useSuiteEnvironment();
  const { signIn, signInWith, backendKinds, accounts, active, status } = useAccounts();
  const extension = useSolidExtension();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const adding = params.get("add") === "1" && active;
  const redirecting = useRef(false);
  const finishSignIn = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    router.replace(safeNext(next));
  }, [next, router]);
  useEffect(() => {
    // A reload (including dev Fast Refresh) can restore a committed popup grant after
    // the submit handler has gone away. Session readiness owns the transition.
    if (status === "ready" && active && !adding) finishSignIn();
  }, [status, active, adding, finishSignIn]);
  useEffect(() => {
    // Keep the callback transition responsive while the provider owns the popup.
    router.prefetch(safeNext(next));
    void preloadAppFrame().catch(() => {
      /* Navigation can retry a failed preload. */
    });
  }, [next, router]);
  const registration = useRegistration();
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<Failure | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
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
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(state);
    setError(null);
    try {
      await signIn(hint, { signal: controller.signal });
      const issuer = rememberedIssuer(hint);
      if (issuer) remember(issuer);
      finishSignIn();
    } catch (cause) {
      setError(cause instanceof SignInError ? `signin.errors.${cause.code}` : "signin.failed");
    } finally {
      attempt.current = null;
      setPending(null);
    }
  };
  const useExtension = extension.present && backendKinds.includes("extension");
  return (
    <>
      <h1 className="suite-sr-only">{t("signin.title")}</h1>
      {adding && (
        <p role="status" className="shell-public-note">
          {t("signin.adding", { name: active.name })}
        </p>
      )}
      {params.get(SIGNUP_UNAVAILABLE_PARAM) === "unavailable" && (
        <p role="status" className="shell-public-note">
          {t(SIGNUP_UNAVAILABLE_KEY)}
        </p>
      )}
      <fieldset
        disabled={status === "loading"}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <legend className="suite-sr-only">{t("signin.methods")}</legend>
        <SignInCard
          title={t("signin.title")}
          subtitle={t("signin.subtitle")}
          providers={providers}
          recentProviders={recent}
          recentAccounts={recentAccounts}
          pending={pending}
          error={error && t(error)}
          onCancel={() => attempt.current?.abort()}
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
                      finishSignIn();
                    } catch {
                      setError("signin.extensionFailed");
                    }
                  }}
                >
                  {t("signin.extension")}
                </Button>
              )}
              <DemoButton next={next} />
              <p className="shell-public-footer">
                {registration.available && (
                  <>
                    <span>
                      {t("signin.newHere")} <a href="/signup">{t("signin.create")}</a>
                    </span>
                    <span aria-hidden="true"> · </span>
                  </>
                )}
                <PodExplainer />
              </p>
            </div>
          }
        />
      </fieldset>
    </>
  );
}
