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
  } = useSession();
  return (
    <main className="login-screen">
      <fieldset className="login-sign-in" disabled={!ready}>
        <legend className="sr-only">Drive sign-in</legend>
        <SignInCard
          accountsTitle="Choose an account"
          subtitle="to continue to Drive"
          title="Sign in"
          providers={signInProviders()}
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
    </main>
  );
}
