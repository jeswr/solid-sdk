// AUTHORED-BY Claude Sonnet 5.5
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvSessionGate } from "../src/EnvSessionGate.js";

const state = vi.hoisted(() => ({
  webId: null as string | null,
  session: null as unknown,
  restoringSession: false,
  ready: true,
  error: null as string | null,
}));
vi.mock("../src/SessionProvider.js", () => ({ useSession: () => state }));
vi.mock("../src/LoginScreen.js", () => ({
  LoginScreen: (props: Record<string, unknown>) => (
    <output data-testid="login">{JSON.stringify(props)}</output>
  ),
}));
afterEach(() => {
  cleanup();
  state.webId = null;
  state.session = null;
  state.ready = true;
});

const env = {
  VITE_KNOWN_PROVIDERS: "https://a.example/,https://b.example/",
  VITE_HOME_IDP: "https://home.example/",
  VITE_HOME_IDP_NAME: "Home",
  DEV: true,
};

describe("EnvSessionGate", () => {
  it("forwards the env sign-in settings to LoginScreen unchanged", () => {
    render(
      <EnvSessionGate appName="Pod Test" env={env}>
        content
      </EnvSessionGate>,
    );
    expect(JSON.parse(screen.getByTestId("login").textContent ?? "")).toEqual({
      appName: "Pod Test",
      knownProviders: env.VITE_KNOWN_PROVIDERS,
      homeIdp: env.VITE_HOME_IDP,
      homeIdpName: env.VITE_HOME_IDP_NAME,
      dev: true,
    });
  });

  it("lets the sign-in screen use its own app name", () => {
    render(
      <EnvSessionGate appName="Pod Test" loginAppName="Test" env={{}}>
        content
      </EnvSessionGate>,
    );
    expect(JSON.parse(screen.getByTestId("login").textContent ?? "").appName).toBe("Test");
  });

  it("renders the loading card with the app name while starting", () => {
    state.ready = false;
    render(
      <EnvSessionGate appName="Pod Test" env={{}} renderLoading={(label) => <i>{label}</i>}>
        content
      </EnvSessionGate>,
    );
    expect(screen.getByRole("heading", { name: "Pod Test" })).toBeInTheDocument();
    expect(screen.getByText("Loading your account…")).toBeInTheDocument();
  });

  it("renders a `loading` component with the status label", () => {
    state.ready = false;
    render(
      <EnvSessionGate appName="Pod Test" env={{}} loading={({ label }) => <i>spin {label}</i>}>
        content
      </EnvSessionGate>,
    );
    expect(screen.getByText("spin Loading your account…")).toBeInTheDocument();
  });

  it("renders the children for a signed-in session", () => {
    state.webId = "https://alice.example/#me";
    state.session = { webId: state.webId, podRoot: "https://alice.example/" };
    render(
      <EnvSessionGate appName="Pod Test" env={{}}>
        {({ webId }) => <p>hello {webId}</p>}
      </EnvSessionGate>,
    );
    expect(screen.getByText("hello https://alice.example/#me")).toBeInTheDocument();
  });
});
