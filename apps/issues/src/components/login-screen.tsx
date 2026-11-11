// AUTHORED-BY GPT-6.1 Sol
"use client";

import { LoginScreen, useSession } from "@jeswr/app-session/react";
import { useSolidSession } from "@/lib/session-context";
import { APP_NAME, DEV } from "@/lib/pod-auth";

/** Storage selection and tracker failures belong to Issues; sign-in belongs to app-session. */
export function IssuesLoginScreen() {
  const { status, storageChoices } = useSolidSession();
  const { session } = useSession();
  if (session && (storageChoices.length || status === "error")) return <TrackerSetup />;
  return (
    <LoginScreen
      appName={APP_NAME}
      dev={DEV}
      knownProviders={process.env.NEXT_PUBLIC_KNOWN_PROVIDERS}
      homeIdp={process.env.NEXT_PUBLIC_HOME_IDP}
      homeIdpName={process.env.NEXT_PUBLIC_HOME_IDP_NAME}
    />
  );
}

function TrackerSetup() {
  const { status, storageChoices, chooseStorage, error, retry, logout } = useSolidSession();
  return (
    <main id="main" className="login-screen">
      <section
        className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-xl"
        aria-labelledby="storage-heading"
      >
        <h1 id="storage-heading" className="text-xl font-semibold">
          {APP_NAME}
        </h1>
        {storageChoices.length ? (
          <>
            <p>This WebID has several storages — where should your issues live?</p>
            <ul className="space-y-2">
              {storageChoices.map((url) => (
                <li key={url}>
                  <button
                    type="button"
                    disabled={status === "authenticating"}
                    onClick={() => void chooseStorage(url)}
                    className="w-full break-all rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2"
                  >
                    {url}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {!storageChoices.length ? (
          <button type="button" onClick={retry}>
            Try opening tracker again
          </button>
        ) : null}
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </section>
    </main>
  );
}
