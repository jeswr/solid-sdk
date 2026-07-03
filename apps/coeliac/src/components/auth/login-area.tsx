// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The signed-out surface: a short product intro + the suite's
 * `<jeswr-login-panel>` (via the `@jeswr/solid-elements/react` wrapper, loaded
 * client-only so `next build` never registers the custom element on the server).
 * The panel is driven by the injected `LoginController`; silent restore is owned
 * by the SessionProvider, so `autoRestore` is off here (interactive login only).
 */
import type { LoginController, SessionChangeDetail } from "@jeswr/solid-elements/react";
import dynamic from "next/dynamic";

const LoginPanel = dynamic(
  () => import("@jeswr/solid-elements/react").then((m) => m.LoginPanel),
  { ssr: false },
);

export function LoginArea({
  controller,
  onSessionChange,
}: {
  controller: LoginController | null;
  onSessionChange: (detail: SessionChangeDetail) => void;
}) {
  return (
    <main className="login-area">
      <section className="login-area__intro">
        <h1>Coeliac Diary</h1>
        <p className="login-area__tag">
          A pod-owned, multi-intolerance food &amp; symptom diary. Scan a barcode, tap
          &ldquo;Ate it now&rdquo;, log how you feel — your data stays in your own Solid pod,
          forever.
        </p>
        <p className="login-area__disclaimer">
          Decision support, not diagnosis. This app never tells you that you have a disease —
          see a doctor for that.
        </p>
      </section>
      <LoginPanel
        controller={controller ?? undefined}
        autoRestore={false}
        heading="Sign in with your WebID"
        onSessionChange={(e: CustomEvent<SessionChangeDetail>) => onSessionChange(e.detail)}
      />
    </main>
  );
}
