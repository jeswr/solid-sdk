// AUTHORED-BY GPT-6.1 Sol
"use client";

import { LoginScreen } from "@jeswr/app-session/react";
import { APP_NAME, DEV } from "@/lib/pod-auth";

/** Coeliac's product introduction around the shared sign-in screen. */
export function LoginArea() {
  return (
    <div className="login-area">
      <section className="login-area__intro">
        <h1>Coeliac Diary</h1>
        <p className="login-area__tag">
          A pod-owned, multi-intolerance food &amp; symptom diary. Scan a barcode, tap &ldquo;Ate it
          now&rdquo;, log how you feel — your data stays in your own Solid pod, forever.
        </p>
        <p className="login-area__disclaimer">
          Decision support, not diagnosis. This app never tells you that you have a disease — see a
          doctor for that.
        </p>
      </section>
      <LoginScreen
        appName={APP_NAME}
        knownProviders={process.env.NEXT_PUBLIC_KNOWN_PROVIDERS}
        homeIdp={process.env.NEXT_PUBLIC_HOME_IDP}
        homeIdpName={process.env.NEXT_PUBLIC_HOME_IDP_NAME}
        dev={DEV}
      />
    </div>
  );
}
