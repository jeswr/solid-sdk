// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
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
import type { ChatRoomsProps } from "@jeswr/pod-chat/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getPodAuth, legacyCredentials } from "./auth/pod-auth";

const chatRooms = vi.hoisted(() => vi.fn());
vi.mock("@jeswr/pod-chat/ui", () => ({
  ChatRooms: (props: ChatRoomsProps) => {
    chatRooms(props);
    return <p>Your private rooms</p>;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const profile: Profile = {
  webId: WEB_ID,
  name: "Alice Chat",
  storages: [POD_ROOT],
  oidcIssuers: [ISSUER],
};

function renderChat(
  auth: ReturnType<typeof fakePodAuth>["auth"],
  readProfile = async () => profile,
) {
  return render(
    <StrictMode>
      <ThemeProvider storageKey="pod-chat:app-shell-theme">
        <SessionProvider
          getPodAuth={getPodAuth}
          auth={auth}
          appName="Pod Chat"
          dev={import.meta.env.DEV}
          legacyCredentials={legacyCredentials}
          readProfile={readProfile}
        >
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

it("uses shared sign-in and clears only Chat's obsolete stores once under StrictMode", async () => {
  const fake = fakePodAuth();
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  localStorage.setItem("pod-chat:remembered-account", "obsolete");
  localStorage.setItem("pod-chat:app-shell-theme", "dark");
  localStorage.setItem("pod-docs:remembered-account", "other app");
  sessionStorage.setItem("pod-chat:autologin-attempted", WEB_ID);
  sessionStorage.setItem("pod-chat:pss.autologin.flow", "obsolete");
  sessionStorage.setItem("pod-docs:pss.autologin.flow", "other app");
  const ambientFetch = globalThis.fetch;
  renderChat(fake.auth);

  expect(await screen.findByText("to continue to Pod Chat")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "WebID" })).toBeEnabled();
  expect(screen.queryByText("Your private rooms")).not.toBeInTheDocument();
  expect(document.querySelector("jeswr-loading")).toBeNull();
  expect(chatRooms).not.toHaveBeenCalled();
  expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("pod-chat:sessions");
  expect(localStorage.getItem("pod-chat:remembered-account")).toBeNull();
  expect(sessionStorage.getItem("pod-chat:autologin-attempted")).toBeNull();
  expect(sessionStorage.getItem("pod-chat:pss.autologin.flow")).toBeNull();
  expect(localStorage.getItem("pod-chat:app-shell-theme")).toBe("dark");
  expect(localStorage.getItem("pod-docs:remembered-account")).toBe("other app");
  expect(sessionStorage.getItem("pod-docs:pss.autologin.flow")).toBe("other app");
  expect(fake.auth.restore).toHaveBeenCalledTimes(1);
  expect(fake.auth.login).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(ambientFetch);
});

it("keeps the host loading labels through restore and profile loading, then signs out of Chat", async () => {
  const fake = fakePodAuth();
  const restored = deferred<typeof identity | null>();
  const readProfile = deferred<Profile>();
  fake.auth.restore.mockReturnValue(restored.promise);
  const ambientFetch = globalThis.fetch;
  const { container } = renderChat(fake.auth, () => readProfile.promise);
  const loading = container.querySelector("jeswr-loading") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pod Chat");
  expect(
    container.querySelector(
      "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
    ),
  ).toContainElement(loading);
  await loading.updateComplete;
  expect(loading).toHaveAttribute("label", "Restoring your session…");
  expect(loading.shadowRoot?.querySelector('[part="status"]')).toHaveAttribute(
    "aria-label",
    "Restoring your session…",
  );
  expect(chatRooms).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "WebID" })).not.toBeInTheDocument();

  await act(async () => restored.resolve(identity));
  await loading.updateComplete;
  expect(loading).toHaveAttribute("label", "Loading your account…");
  expect(loading.shadowRoot?.querySelector('[part="status"]')).toHaveAttribute(
    "aria-label",
    "Loading your account…",
  );
  expect(loading.shadowRoot?.querySelector('[part="label"]')).toHaveTextContent(
    "Loading your account…",
  );
  expect(chatRooms).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "WebID" })).not.toBeInTheDocument();
  await act(async () => readProfile.resolve(profile));

  expect(await screen.findByText("Your private rooms")).toBeInTheDocument();
  expect(container.querySelector("jeswr-loading")).toBeNull();
  expect(chatRooms).toHaveBeenLastCalledWith(
    expect.objectContaining({ webId: WEB_ID, podRoot: POD_ROOT, fetch: fake.auth.fetch }),
  );
  expect(fake.auth.restore).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).toBe(ambientFetch);

  fireEvent(
    screen.getByRole("button", { name: "Account menu" }),
    new MouseEvent("pointerdown", { bubbles: true }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: /sign out/i }));
  await waitFor(() => expect(fake.auth.logout).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("to continue to Pod Chat")).toBeInTheDocument();
  expect(screen.queryByText("Your private rooms")).not.toBeInTheDocument();
  expect(globalThis.fetch).toBe(ambientFetch);
});
