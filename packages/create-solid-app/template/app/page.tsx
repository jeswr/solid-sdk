"use client";
// Home: shows the LoginPanel when logged out, the ProfileCard when logged in.
// Both read state from <SolidAuthProvider> via useSolidAuth().
//
// Side-effect import registers the @jeswr/solid-elements custom elements (each
// component module self-`customElements.define`s, guarded against double-load), so
// the raw <jeswr-loading> tag used below upgrades. The suite wait-state spinner
// themes itself from the SAME app-shell OKLCH tokens as the rest of the chrome
// (its shadow styles read --jeswr-* → app-shell --primary/--border/…), so it
// follows light/dark for free. We use the RAW-ATTRIBUTE form (`label="…"`) rather
// than the @lit/react `<Loading label>` wrapper because the wrapper drops the
// `label` property in @lit/react's `node` export mode (SSR/Vitest) — see
// types/solid-elements.d.ts.
import "@jeswr/solid-elements/react";
import { useSolidAuth } from "@/components/solid/SolidAuthProvider";
import { LoginPanel } from "@/components/solid/LoginPanel";
import { ProfileCard } from "@/components/solid/ProfileCard";

export default function Home() {
  const { webId, autologinPending } = useSolidAuth();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Solid app</h1>
        <p className="max-w-md text-muted-foreground">
          Log in with your Solid Pod, read your profile, and build on your own
          data.
        </p>
      </div>
      {/* A deep-link autologin (#autologin/<webid>) is mid-redirect or completing —
          show a "Signing you in…" state instead of the login panel so the silent SSO
          doesn't flash the login form. */}
      {webId ? (
        <ProfileCard />
      ) : autologinPending ? (
        // Suite wait-state: the themed <jeswr-loading> spinner + a contextual,
        // polite-live label (raw-attribute form — the reliable label path).
        <jeswr-loading label="Signing you in…" />
      ) : (
        <LoginPanel />
      )}
    </main>
  );
}
