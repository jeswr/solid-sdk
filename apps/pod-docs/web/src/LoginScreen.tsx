// AUTHORED-BY Codex GPT-6.1-Sol
import {
  classifyLoginInput,
  KNOWN_PROVIDERS,
  providersFromConfig,
} from "@jeswr/pod-auth/directory";
import { sameIssuer } from "@jeswr/reactive-authentication";
import { SignInCard, type SignInProvider } from "@jeswr/suite-ui/sign-in";
import "@jeswr/suite-ui/styles/sign-in.css";
import { allowInsecureLoopback } from "./auth/pod-auth";
import { useSession } from "./auth/SessionProvider";

export function signInProviders(): SignInProvider[] {
  const providers = providersFromConfig(import.meta.env.VITE_KNOWN_PROVIDERS, KNOWN_PROVIDERS);
  const home = import.meta.env.VITE_HOME_IDP ?? "https://idp.solid-test.jeswr.org";
  if (classifyLoginInput(home, { allowInsecureLoopback: allowInsecureLoopback() }) === "invalid")
    return providers;
  const issuer = new URL(home.trim()).href;
  const known = KNOWN_PROVIDERS.find((provider) => sameIssuer(provider.issuer, issuer));
  return [
    {
      ...known,
      id: "home",
      issuer,
      name: import.meta.env.VITE_HOME_IDP_NAME?.trim() || new URL(issuer).host,
    },
    ...providers.filter((provider) => !sameIssuer(provider.issuer, issuer)),
  ];
}

/** The providers a WebID lists, named from the directory where it knows them. */
export function issuerChoiceProviders(issuers: readonly string[]): SignInProvider[] {
  const known = signInProviders();
  return issuers.map((issuer, index) => {
    const match = known.find((provider) => sameIssuer(provider.issuer, issuer));
    return match ?? { id: `listed-${index}`, issuer, name: new URL(issuer).host };
  });
}

export function LoginScreen() {
  const {
    loginWithAddress,
    loginWithIssuer,
    loginWithAccount,
    pending,
    error,
    ready,
    recentAccounts,
    recentProviders,
    retry,
    startupFailed,
    issuerChoice: choice,
  } = useSession();
  return (
    <main className="login-screen">
      <fieldset className="login-sign-in" disabled={!ready}>
        <legend className="sr-only">Pod Docs sign-in</legend>
        <SignInCard
          key={choice ? `choice:${choice.webId}` : "sign-in"}
          accountsTitle="Choose an account"
          subtitle={
            choice
              ? `Choose the provider for ${new URL(choice.webId).host}`
              : "to continue to Pod Docs"
          }
          title="Sign in"
          defaultView={choice ? "sign-in" : undefined}
          providers={choice ? issuerChoiceProviders(choice.issuers) : signInProviders()}
          recentAccounts={recentAccounts}
          recentProviders={recentProviders}
          pending={pending}
          error={error}
          onWebId={(input) => {
            void loginWithAddress(input);
          }}
          onCustomProvider={(input) => {
            void loginWithAddress(input, "custom");
          }}
          onProvider={(provider) => {
            void loginWithIssuer(provider.issuer);
          }}
          onAccount={(account) => {
            void loginWithAccount(account.webId);
          }}
        />
      </fieldset>
      {startupFailed ? (
        <button type="button" className="login-retry" onClick={retry}>
          Try again
        </button>
      ) : null}
    </main>
  );
}
