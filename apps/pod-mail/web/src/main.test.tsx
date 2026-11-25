// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6
import { deferred, fakePodAuth } from "@jeswr/app-session/testing";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ root: undefined as Root | undefined }));
const { auth } = fakePodAuth();
vi.mock("./auth/pod-auth", () => ({ getPodAuth: async () => auth }));
vi.mock("react-dom/client", async (original) => {
  const { createRoot } = await original<typeof import("react-dom/client")>();
  return {
    createRoot: (container: HTMLElement) => {
      host.root = createRoot(container);
      return host.root;
    },
  };
});

afterEach(async () => {
  await act(async () => host.root?.unmount());
  document.getElementById("root")?.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

it("mounts shared sign-in with Mail's provider settings and removes only Mail's old credentials", async () => {
  const ambient = globalThis.fetch;
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  vi.stubEnv("VITE_HOME_IDP", "https://mail-provider.example/");
  vi.stubEnv("VITE_HOME_IDP_NAME", "Mail provider");
  vi.stubEnv("VITE_KNOWN_PROVIDERS", "https://other-provider.example/");
  auth.login.mockImplementation(() => deferred<Awaited<ReturnType<typeof auth.login>>>().promise);
  localStorage.setItem("pod-mail.remembered-account", "obsolete pointer");
  localStorage.setItem("pod-mail:app-shell-theme", "dark");
  localStorage.setItem("pod-drive.remembered-account", "other app");
  sessionStorage.setItem("pod-mail:pss.autologin.flow", "obsolete private key and verifier");
  sessionStorage.setItem("pod-mail:autologin-attempted", "obsolete loop guard");
  sessionStorage.setItem("pod-drive:autologin-attempted", "other app");
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);

  await act(async () => {
    await import("./main");
  });

  expect(screen.getByRole("group", { name: "Pod Mail sign-in" })).toBeEnabled();
  expect(screen.getByText("to continue to Pod Mail")).toBeVisible();
  expect(screen.getByRole("button", { name: /other-provider.example/i })).toBeVisible();
  expect(auth.restore).toHaveBeenCalledTimes(1);
  expect(deleteDatabase.mock.calls).toEqual([["pod-mail:sessions"]]);
  expect(localStorage.getItem("pod-mail.remembered-account")).toBeNull();
  expect(sessionStorage.getItem("pod-mail:pss.autologin.flow")).toBeNull();
  expect(sessionStorage.getItem("pod-mail:autologin-attempted")).toBeNull();
  expect(localStorage.getItem("pod-mail:app-shell-theme")).toBe("dark");
  expect(localStorage.getItem("pod-drive.remembered-account")).toBe("other app");
  expect(sessionStorage.getItem("pod-drive:autologin-attempted")).toBe("other app");

  fireEvent.click(screen.getByRole("button", { name: /mail provider/i }));
  await waitFor(() =>
    expect(auth.login).toHaveBeenCalledWith(
      { issuer: "https://mail-provider.example/" },
      { signal: expect.any(AbortSignal) },
    ),
  );
  expect(globalThis.fetch).toBe(ambient);
});
