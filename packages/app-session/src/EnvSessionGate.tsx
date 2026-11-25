// AUTHORED-BY Claude Sonnet 5.5
import type { ComponentType, ReactNode } from "react";
import { LoginScreen } from "./LoginScreen.js";
import { SessionGate, type SignedInSession } from "./SessionGate.js";

/** The build-time env slice an app forwards (Vite's `import.meta.env`, passed whole by the app). */
export interface SessionGateEnv {
  VITE_KNOWN_PROVIDERS?: string;
  VITE_HOME_IDP?: string;
  VITE_HOME_IDP_NAME?: string;
  DEV?: boolean;
}

export interface EnvSessionGateProps {
  /** Heading on the loading card (and, unless `loginAppName` is set, the sign-in screen). */
  appName: string;
  /** Override the sign-in screen's app name when it differs from the loading heading. */
  loginAppName?: string;
  /** The app's `import.meta.env`; its sign-in settings are passed to `LoginScreen` unchanged. */
  env: SessionGateEnv;
  children: ReactNode | ((signedIn: SignedInSession) => ReactNode);
  renderLoading?: (label: string) => ReactNode;
  /** Shorthand for `renderLoading`: a component rendered with the status `label` prop. */
  loading?: ComponentType<{ label: string }>;
}

/**
 * `SessionGate` with the standard configured `LoginScreen`. Purely presentational wiring:
 * the env values are forwarded as-is and no sign-in or session behaviour changes.
 */
export function EnvSessionGate({
  appName,
  loginAppName = appName,
  env,
  children,
  renderLoading,
  loading: LoadingIndicator,
}: EnvSessionGateProps) {
  return (
    <SessionGate
      appName={appName}
      login={
        <LoginScreen
          appName={loginAppName}
          knownProviders={env.VITE_KNOWN_PROVIDERS}
          homeIdp={env.VITE_HOME_IDP}
          homeIdpName={env.VITE_HOME_IDP_NAME}
          dev={env.DEV}
        />
      }
      renderLoading={
        renderLoading ?? (LoadingIndicator && ((label) => <LoadingIndicator label={label} />))
      }
    >
      {children}
    </SessionGate>
  );
}
