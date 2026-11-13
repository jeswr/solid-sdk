// AUTHORED-BY GPT-6.1 Sol
import { SessionProvider } from "@jeswr/app-session/react";
import {
  deferred,
  fakePodAuth,
  ISSUER,
  identity,
  POD_ROOT,
  WEB_ID,
} from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { APP_NAME, LEGACY_CREDENTIALS } from "./auth/pod-auth";

// Observe the host spinner's labels without Lit's node-export prop limitations.
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

const profile = {
  webId: WEB_ID,
  name: "Alice Health",
  storages: [POD_ROOT],
  oidcIssuers: [ISSUER],
};
const readProfile = async () => profile;
const index = `${POD_ROOT}settings/privateTypeIndex.ttl`;
const record = `${POD_ROOT}records/private.ttl`;
const recordTurtle = `@prefix health: <https://jeswr.org/ns/sectors/health#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
<#record> a health:HealthRecord.
<#pulse> a health:Observation; health:value "72"^^xsd:decimal.`;

function renderHost(fake: ReturnType<typeof fakePodAuth>, reader = readProfile) {
  return render(
    <StrictMode>
      <ThemeProvider storageKey="pod-health:app-shell-theme">
        <SessionProvider
          auth={fake.auth}
          getPodAuth={async () => fake.auth}
          appName={APP_NAME}
          legacyCredentials={LEGACY_CREDENTIALS}
          readProfile={reader}
        >
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

describe("Health with the shared session provider", () => {
  it("uses the host spinner while restoring identity and loading its profile", async () => {
    const fake = fakePodAuth();
    const restoring = deferred<typeof identity | null>();
    const readingProfile = deferred<typeof profile>();
    fake.auth.restore.mockReturnValue(restoring.promise);
    const { container } = renderHost(fake, () => readingProfile.promise);
    expect(await screen.findByRole("status")).toHaveTextContent("Restoring your session…");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(APP_NAME);
    expect(
      container.querySelector(
        "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
      ),
    ).toContainElement(screen.getByRole("status"));
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(fake.auth.fetch).not.toHaveBeenCalled();

    await act(async () => restoring.resolve(identity));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(document.querySelector(".app-shell")).toBeNull();
    expect(fake.auth.fetch).not.toHaveBeenCalled();

    fake.auth.fetch.mockResolvedValue(
      new Response("", { headers: { "content-type": "text/turtle" } }),
    );
    await act(async () => readingProfile.resolve(profile));
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(container.querySelector(".login-screen")).toBeNull();
  });

  it("shows the configured login when restore finds no session", async () => {
    renderHost(fakePodAuth());
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pod Health sign-in" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(".pod-health-records")).toBeNull();
  });

  it("restores once and passes auth.fetch through private discovery and the records store", async () => {
    const fake = fakePodAuth();
    const restoring = deferred<typeof identity | null>();
    fake.auth.restore.mockReturnValue(restoring.promise);
    const documents: Record<string, string> = {
      [WEB_ID]: `<${WEB_ID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      [index]: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<#health> a solid:TypeRegistration;
  solid:forClass <https://jeswr.org/ns/sectors/health#HealthRecord>;
  solid:instance <${record}>.`,
      [record]: recordTurtle,
    };
    fake.auth.fetch.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = documents[url];
      if (!body) throw new Error(`Unexpected pod read: ${url}`);
      return new Response(body, { headers: { "content-type": "text/turtle" } });
    });
    const ambientFetch = globalThis.fetch;
    sessionStorage.setItem("pod-health:pss.autologin.flow", "old flow");
    localStorage.setItem("pod-health:remembered-account", "old account");
    renderHost(fake);
    expect(document.querySelector('main[aria-busy="true"]')).not.toBeNull();
    await act(async () => restoring.resolve(identity));
    await waitFor(() => expect(document.querySelectorAll("tr.pod-health-row")).toHaveLength(2));
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
    expect([...new Set(fake.auth.fetch.mock.calls.map(([url]) => String(url)))]).toEqual([
      WEB_ID,
      index,
      record,
    ]);
    expect(globalThis.fetch).toBe(ambientFetch);
    expect(sessionStorage.getItem("pod-health:pss.autologin.flow")).toBeNull();
    expect(localStorage.getItem("pod-health:remembered-account")).toBeNull();
  });

  it("keeps the conventional record fallback and its explanatory note", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    fake.auth.fetch.mockImplementation(
      async (input) =>
        new Response(String(input) === WEB_ID ? "" : recordTurtle, {
          headers: { "content-type": "text/turtle" },
        }),
    );
    renderHost(fake);
    await screen.findByText("72");
    expect(screen.getByRole("note")).toHaveTextContent(`${POD_ROOT}health/record.ttl`);
    expect(fake.auth.fetch).toHaveBeenCalledWith(`${POD_ROOT}health/record.ttl`, expect.anything());
  });

  it.each([
    false,
    true,
  ])("signs in and clears records on sign-out (extension: %s)", async (extension) => {
    if (extension) document.documentElement.setAttribute("data-solid-extension", "1");
    const fake = fakePodAuth();
    fake.auth.remembered.mockResolvedValue([
      { webId: WEB_ID, issuer: ISSUER, displayName: "Alice Health" },
    ]);
    fake.auth.fetch.mockImplementation(
      async (input) =>
        new Response(String(input) === WEB_ID ? "" : recordTurtle, {
          headers: { "content-type": "text/turtle" },
        }),
    );
    renderHost(fake);
    const account = await screen.findByRole("button", { name: /Alice Health/ });
    expect(screen.getByRole("group", { name: "Pod Health sign-in" })).toBeInTheDocument();
    fireEvent.click(account);
    await screen.findByText("72");
    expect(fake.auth.login).toHaveBeenCalledWith(
      { webId: WEB_ID, issuer: ISSUER },
      { signal: expect.any(AbortSignal) },
    );
    if (extension) {
      expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    } else {
      expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
      fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    }
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.querySelector(".pod-health-records")).toBeNull();
  });
});
