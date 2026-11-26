// AUTHORED-BY Claude Sonnet 5.5
import { LoginScreen } from "./LoginScreen.js";

/** The build-time env slice an app forwards (Vite's `import.meta.env`, passed whole by the app). */
export interface LoginScreenEnv {
  VITE_KNOWN_PROVIDERS?: string;
  VITE_HOME_IDP?: string;
  VITE_HOME_IDP_NAME?: string;
  DEV?: boolean;
}

export interface EnvLoginScreenProps {
  appName: string;
  /** The app's `import.meta.env`; its sign-in settings are passed to `LoginScreen` unchanged. */
  env: LoginScreenEnv;
}

/**
 * `LoginScreen` configured from an app's env object. Purely presentational wiring: the env
 * values are forwarded as-is and no sign-in or session behaviour changes.
 */
export function EnvLoginScreen({ appName, env }: EnvLoginScreenProps) {
  return (
    <LoginScreen
      appName={appName}
      knownProviders={env.VITE_KNOWN_PROVIDERS}
      homeIdp={env.VITE_HOME_IDP}
      homeIdpName={env.VITE_HOME_IDP_NAME}
      dev={env.DEV}
    />
  );
}
