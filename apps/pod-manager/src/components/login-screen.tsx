// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import Link from "next/link";
import {
  classifyLoginInput,
  KNOWN_PROVIDERS,
  providersFromConfig,
} from "@jeswr/pod-auth/directory";
import { sameIssuer } from "@jeswr/reactive-authentication";
import { SignInCard, type SignInProvider } from "@jeswr/suite-ui/sign-in";
import "@jeswr/suite-ui/styles/sign-in.css";
import "./sign-in-theme.css";
import { useSession } from "@/components/session-provider";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { allowInsecureLoopback } from "@/lib/auth-environment";

export function signInProviders(): SignInProvider[] {
  const providers = providersFromConfig(process.env.NEXT_PUBLIC_KNOWN_PROVIDERS, KNOWN_PROVIDERS);
  const home = process.env.NEXT_PUBLIC_HOME_IDP ?? "https://idp.solid-test.jeswr.org";
  if (classifyLoginInput(home, { allowInsecureLoopback: allowInsecureLoopback() }) === "invalid")
    return providers;
  const issuer = new URL(home.trim()).href;
  const known = KNOWN_PROVIDERS.find((provider) => sameIssuer(provider.issuer, issuer));
  return [
    {
      ...known,
      id: "home",
      issuer,
      name: process.env.NEXT_PUBLIC_HOME_IDP_NAME?.trim() || new URL(issuer).host,
    },
    ...providers.filter((provider) => !sameIssuer(provider.issuer, issuer)),
  ];
}

export function LoginScreen() {
  const session = useSession();
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-accent/30 to-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <fieldset disabled={!session.ready} className="min-w-0">
          <legend className="sr-only">Pod Manager sign-in</legend>
          <SignInCard
            title="Sign in"
            accountsTitle="Choose an account"
            subtitle="to continue to Pod Manager"
            providers={signInProviders()}
            recentAccounts={session.recentAccounts}
            recentProviders={session.recentProviders}
            pending={session.pending}
            error={session.error}
            onWebId={(input) => {
              void session.loginWithAddress(input);
            }}
            onCustomProvider={(input) => {
              void session.loginWithAddress(input, "custom");
            }}
            onProvider={(provider) => {
              void session.loginWithIssuer(provider.issuer);
            }}
            onAccount={(account) => {
              void session.loginWithAccount(account.webId);
            }}
            onCancel={session.cancelLogin}
          />
        </fieldset>
        {session.startupFailed && (
          <Button type="button" className="mt-4 w-full" onClick={session.retry}>
            Try again
          </Button>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Your files, calendar and contacts in a private store you own.
        </p>
        <footer className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:underline">
            Privacy policy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms of service
          </Link>
        </footer>
      </div>
    </main>
  );
}
