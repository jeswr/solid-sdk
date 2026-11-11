// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "@jeswr/app-session/react";
import { IssuerChoiceRequiredError } from "@jeswr/app-session";
import { fakePodAuth, identity, ISSUER, WEB_ID } from "@jeswr/app-session/testing";
import { IssuesLoginScreen } from "./login-screen";

const local = vi.hoisted(() => ({
  status: "logged-out",
  storageChoices: [] as string[],
  error: null as string | null,
  chooseStorage: vi.fn(),
  logout: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/session-context", () => ({ useSolidSession: () => local }));
let fake: ReturnType<typeof fakePodAuth>;
function ReadyScreen() {
  const { ready } = useSession();
  return ready ? <IssuesLoginScreen /> : null;
}
function mount() {
  return render(
    <SessionProvider
      getPodAuth={async () => fake.auth}
      auth={fake.auth}
      appName="Solid Issues"
      readProfile={async (webId) => ({ webId, name: "Alice", storages: [], oidcIssuers: [] })}
    >
      <ReadyScreen />
    </SessionProvider>,
  );
}
beforeEach(() => {
  fake = fakePodAuth();
  local.status = "logged-out";
  local.storageChoices = [];
  local.error = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("uses the shared two-step screen with Issues' app name and providers", async () => {
  mount();
  expect(await screen.findByText("to continue to Solid Issues")).toBeTruthy();
  expect(screen.getByLabelText("WebID")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Providers" })).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByRole("group", { name: "Solid Issues sign-in" }) as HTMLFieldSetElement).disabled,
    ).toBe(false),
  );
});

it("continues a remembered account through pod-auth with an abort signal", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER, displayName: "Alice" }]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
  await waitFor(() =>
    expect(fake.auth.login).toHaveBeenCalledWith(
      { webId: WEB_ID, issuer: ISSUER },
      { signal: expect.any(AbortSignal) },
    ),
  );
  expect(fake.auth.logout).not.toHaveBeenCalled();
});

it("keeps the WebID when an issuer choice is required", async () => {
  const other = "https://other-provider.example/";
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER, displayName: "Alice" }]);
  fake.auth.login.mockRejectedValueOnce(new IssuerChoiceRequiredError([ISSUER, other]));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
  const provider = await screen.findByRole("button", { name: /other-provider.example/ });
  fireEvent.click(provider);
  await waitFor(() =>
    expect(fake.auth.login).toHaveBeenLastCalledWith(
      { webId: WEB_ID, issuer: other },
      { signal: expect.any(AbortSignal) },
    ),
  );
});

it("keeps Issues' storage chooser separate from the shared sign-in screen", async () => {
  fake.auth.restore.mockResolvedValue(identity);
  local.status = "choose-storage";
  local.storageChoices = ["https://storage.example/one/", "https://storage.example/two/"];
  mount();
  const storage = await screen.findByRole("button", { name: local.storageChoices[1] });
  fireEvent.click(storage);
  expect(local.chooseStorage).toHaveBeenCalledWith(local.storageChoices[1]);
  expect(screen.queryByLabelText("WebID")).toBeNull();
  await act(async () => {});
});
