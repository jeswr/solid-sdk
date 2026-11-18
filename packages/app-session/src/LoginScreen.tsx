// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  classifyLoginInput,
  KNOWN_PROVIDERS,
  providersFromConfig,
} from "@jeswr/pod-auth/directory";
import { sameIssuer } from "@jeswr/reactive-authentication";
import { SignInCard, type SignInProvider } from "@jeswr/suite-ui/sign-in";
import "@jeswr/suite-ui/styles/sign-in.css";
import { allowInsecureLoopback } from "./pod-auth.js";
import { useSession } from "./SessionProvider.js";

export interface SignInProviderOptions {
  knownProviders?: string;
  homeIdp?: string;
  homeIdpName?: string;
  dev?: boolean;
}

export function signInProviders(options: SignInProviderOptions = {}): SignInProvider[] {
  const providers = providersFromConfig(options.knownProviders, KNOWN_PROVIDERS);
  const home = options.homeIdp ?? "https://idp.solid-test.jeswr.org";
  if (
    classifyLoginInput(home, {
      allowInsecureLoopback: allowInsecureLoopback(options.dev ?? false),
    }) === "invalid"
  )
    return providers;
  const issuer = new URL(home.trim()).href;
  const known = KNOWN_PROVIDERS.find((provider) => sameIssuer(provider.issuer, issuer));
  return [
    {
      ...known,
      id: "home",
      issuer,
      name: options.homeIdpName?.trim() || new URL(issuer).host,
    },
    ...providers.filter((provider) => !sameIssuer(provider.issuer, issuer)),
  ];
}

/** The providers a WebID lists, named from the directory where it knows them. */
export function issuerChoiceProviders(
  issuers: readonly string[],
  options?: SignInProviderOptions,
): SignInProvider[] {
  const known = signInProviders(options);
  return issuers.map((issuer, index) => {
    const match = known.find((provider) => sameIssuer(provider.issuer, issuer));
    return match ?? { id: `listed-${index}`, issuer, name: new URL(issuer).host };
  });
}

export interface LoginScreenProps extends SignInProviderOptions {
  appName: string;
}

export function LoginScreen({ appName, ...options }: LoginScreenProps) {
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
      <fieldset
        className="login-sign-in"
        disabled={!ready}
        style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: 0 }}
      >
        <legend className="sr-only">{appName} sign-in</legend>
        <SignInCard
          key={choice ? `choice:${choice.webId}` : "sign-in"}
          accountsTitle="Choose an account"
          subtitle={
            choice
              ? `Choose the provider for ${new URL(choice.webId).host}`
              : `to continue to ${appName}`
          }
          title="Sign in"
          defaultView={choice ? "sign-in" : undefined}
          providers={
            choice ? issuerChoiceProviders(choice.issuers, options) : signInProviders(options)
          }
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
