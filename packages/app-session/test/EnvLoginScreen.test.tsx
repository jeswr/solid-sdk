// AUTHORED-BY Claude Sonnet 5.5
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvLoginScreen } from "../src/EnvLoginScreen.js";

vi.mock("../src/LoginScreen.js", () => ({
  LoginScreen: (props: Record<string, unknown>) => (
    <output data-testid="login">{JSON.stringify(props)}</output>
  ),
}));
afterEach(cleanup);

describe("EnvLoginScreen", () => {
  it("forwards the env sign-in settings to LoginScreen unchanged", () => {
    render(
      <EnvLoginScreen
        appName="Pod Test"
        env={{
          VITE_KNOWN_PROVIDERS: "https://a.example/,https://b.example/",
          VITE_HOME_IDP: "https://home.example/",
          VITE_HOME_IDP_NAME: "Home",
          DEV: true,
        }}
      />,
    );
    expect(JSON.parse(screen.getByTestId("login").textContent ?? "")).toEqual({
      appName: "Pod Test",
      knownProviders: "https://a.example/,https://b.example/",
      homeIdp: "https://home.example/",
      homeIdpName: "Home",
      dev: true,
    });
  });

  it("leaves unset env values unset", () => {
    render(<EnvLoginScreen appName="Pod Test" env={{}} />);
    expect(JSON.parse(screen.getByTestId("login").textContent ?? "")).toEqual({
      appName: "Pod Test",
    });
  });
});
