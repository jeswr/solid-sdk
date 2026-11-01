// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Label } from "@jeswr/suite-ui";
import {
  SignInCard,
  type SignInCardProps,
  type SignInProvider,
  type SignInRecentAccount,
} from "@jeswr/suite-ui/sign-in";
import { useState } from "react";
import "@jeswr/suite-ui/styles/sign-in.css";

// Fixture literals from lane A's directory and suite spec 02-§8.1.
// Re-verify the directory before release; this demo never contacts a provider.
const providers: SignInProvider[] = [
  {
    id: "home",
    name: "solid-test.jeswr.org",
    issuer: "https://idp.solid-test.jeswr.org",
  },
  {
    id: "solidcommunity",
    name: "solidcommunity.net",
    issuer: "https://solidcommunity.net/",
    signUpUrl: "https://solidcommunity.net/.account/login/password/register/",
  },
  {
    id: "inrupt",
    name: "Inrupt PodSpaces",
    issuer: "https://login.inrupt.com/",
    signUpUrl: "https://start.inrupt.com/",
  },
  {
    id: "solidweb",
    name: "solidweb.org",
    issuer: "https://solidweb.org/",
  },
  {
    id: "teamid",
    name: "teamid.live",
    issuer: "https://teamid.live/",
  },
];
const accounts: SignInRecentAccount[] = [
  {
    webId: "https://alice.example/profile/card#me",
    name: "Alice Wilder",
    photoUrl: "https://alice.example/photo.png",
  },
  { webId: "https://bram.example/profile/card#me", name: "Bram Kerst" },
];
const states = [
  { id: "default", label: "Default" },
  { id: "accounts", label: "Remembered accounts" },
  { id: "pending", label: "Signing in" },
  { id: "error", label: "WebID error" },
  { id: "account-error", label: "Account error" },
  { id: "custom", label: "Other provider expanded" },
] as const;

function Demo({ state }: { state: string }) {
  const [pending, setPending] = useState<NonNullable<SignInCardProps["pending"]> | null>(
    state === "pending" ? { kind: "provider", key: "home" } : null,
  );
  const [status, setStatus] = useState("");
  return (
    <div className="grid min-w-0 gap-3">
      <SignInCard
        providers={providers}
        recentAccounts={state === "accounts" || state === "account-error" ? accounts : []}
        recentProviders={["https://past.example/", "https://another.example/"]}
        defaultCustomProviderOpen={state === "custom"}
        pending={pending}
        error={
          state === "error"
            ? "We couldn't sign you in. Check your address or choose your provider below."
            : state === "account-error"
              ? "We couldn't sign you in. Try your account again."
              : null
        }
        onWebId={(input) => {
          setStatus(`WebID submitted: ${input}`);
          setPending({ kind: "webid", key: input });
        }}
        onProvider={(provider) => {
          setStatus(`Provider selected: ${provider.name}`);
          setPending({ kind: "provider", key: provider.id });
        }}
        onCustomProvider={(input) => {
          setStatus(`Provider address submitted: ${input}`);
          setPending({ kind: "custom", key: input });
        }}
        onAccount={(account) => {
          setStatus(`Account selected: ${account.name ?? account.webId}`);
          setPending({ kind: "account", key: account.webId });
        }}
        onCancel={() => {
          setPending(null);
          setStatus("Sign-in cancelled");
        }}
        footer={<span>Demo only. Your selection stays on this page.</span>}
      />
      <p role="status">{status}</p>
    </div>
  );
}

export function SignInFixtures({ state }: { state: string }) {
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const visible = states.some((item) => item.id === state)
    ? states.filter((item) => item.id === state)
    : states;
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page" data-density={density}>
      <header className="fixture-heading">
        <a href="/dev/components">All component fixtures</a>
        <h1>SignInCard</h1>
        <p>
          Shared Solid sign-in states. Select a provider to preview progress, then Cancel to reset.
        </p>
      </header>
      <nav className="flex flex-wrap gap-3" aria-label="Sign-in fixture states">
        <a href="/dev/components/sign-in">All states</a>
        {states.map((item) => (
          <a
            key={item.id}
            href={`?state=${item.id}`}
            aria-current={state === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="sign-in-density">Density</Label>
        <select
          id="sign-in-density"
          value={density}
          onChange={(event) =>
            setDensity(event.target.value === "compact" ? "compact" : "comfortable")
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </div>
      <div
        className="grid items-start gap-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 400px))" }}
      >
        {visible.map((item) => (
          <section
            key={item.id}
            className="grid min-w-0 gap-3"
            aria-label={item.label}
            data-fixture={item.id}
          >
            <h2>{item.label}</h2>
            <Demo state={item.id} />
          </section>
        ))}
      </div>
    </main>
  );
}
