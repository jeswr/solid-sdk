// AUTHORED-BY Claude Opus 5.5
import { IntegrationAuthError, type TokenSet } from "@jeswr/pod-connectors";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

// A configured client id makes Spotify a live OAuth connector in this file's registry.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONNECTOR_SPOTIFY_CLIENT_ID = "test-spotify-client";
});
const login = vi.hoisted(() => vi.fn());
let session: { webId: string; storageUrl: string; fetch: typeof fetch };

vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => session,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../src/apps/home/components/connect/oauth-login", async (original) => ({
  ...(await original<typeof import("../src/apps/home/components/connect/oauth-login")>()),
  login,
}));

import { ConnectFlow } from "../src/apps/home/components/connect/flow";
import { withConnectorLock } from "../src/apps/home/lib/connect/import-lock";
import { CONNECTORS_KEY } from "../src/apps/home/state/connectors";

beforeEach(async () => {
  localStorage.clear();
  login.mockReset();
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
  });
  session = { webId: DEMO_WEBID, storageUrl: DEMO_ROOT, fetch: pod.fetch };
});
afterEach(() => vi.restoreAllMocks());

function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}
function heading(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll("h2")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing ${text} heading`);
  return found;
}
const liveRegion = (host: HTMLElement) =>
  host.querySelector(".hm-connect-page > [role='status']") as HTMLElement;
const panel = (host: HTMLElement) => host.querySelector(".hm-connect-flow .hm-connect-result");
const recorded = (id: string) =>
  localStorage.getItem(`${CONNECTORS_KEY}:${JSON.stringify([DEMO_WEBID, id])}`);
/** Sign-in that waits until the run is cancelled, as an unfinished popup does. */
function pendingSignIn(closed = false) {
  login.mockImplementation(
    (_id: string, _config: unknown, signal: AbortSignal, _blocked: unknown, onClosed: () => void) =>
      new Promise<TokenSet>((_resolve, reject) => {
        if (closed) onClosed();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
}
async function signIn(host: HTMLElement) {
  await click(button(host, "Continue"));
  await click(button(host, "Continue with Spotify"));
}

it("returns to sign-in with a visible, announced notice when sign-in is cancelled", async () => {
  pendingSignIn();
  const { host } = await mount(h(ConnectFlow, { service: "spotify" }));
  await signIn(host);
  expect(login).toHaveBeenCalledOnce();
  expect(panel(host)?.textContent).toContain("Waiting for Spotify…");
  await click(button(host, "Cancel"));
  await vi.waitFor(() => expect(document.activeElement).toBe(heading(host, "Sign in to Spotify")));
  expect(panel(host)?.textContent).toContain("Sign-in to Spotify cancelled.");
  expect(liveRegion(host).textContent).toBe("Sign-in to Spotify cancelled.");
  expect(button(host, "Continue with Spotify")).toBeDefined();
  // Abandoning sign-in is not a sync attempt.
  expect(recorded("spotify")).toBeNull();
});

it("softens the closed-popup hint because a COOP provider can make an open popup read closed", async () => {
  pendingSignIn(true);
  const { host } = await mount(h(ConnectFlow, { service: "spotify" }));
  await signIn(host);
  const hint = "If you closed the sign-in window, choose Cancel.";
  expect(panel(host)?.textContent).toContain(hint);
  expect(panel(host)?.textContent).not.toContain("Didn't finish");
  expect(liveRegion(host).textContent).toBe(hint);
  expect(button(host, "Cancel")).toBeDefined();
});

it("shows a sign-in failure that is not a cancellation as an error without recording a run", async () => {
  login.mockRejectedValue(
    new IntegrationAuthError("spotify", "exchange-failed", "Spotify refused the sign-in."),
  );
  const { host } = await mount(h(ConnectFlow, { service: "spotify" }));
  await signIn(host);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(heading(host, "Spotify sync didn't finish")),
  );
  expect(panel(host)?.textContent).toContain("Spotify refused the sign-in.");
  expect(liveRegion(host).textContent).toBe(
    "Spotify sync didn't finish. Spotify refused the sign-in.",
  );
  expect(recorded("spotify")).toBeNull();
  await click(button(host, "Try again"));
  expect(document.activeElement).toBe(heading(host, "Choose what to sync"));
});

it("says the sync, not sign-in, was cancelled when sign-in finished but the run had not started", async () => {
  login.mockResolvedValue({ accessToken: "memory-only", tokenType: "Bearer" } as TokenSet);
  // Another tab holds this connector's reservation; sign-in itself never waits for it.
  const release = deferred<void>();
  const held = withConnectorLock(
    DEMO_ROOT,
    "spotify",
    new AbortController().signal,
    () => release.promise,
  );
  const { host } = await mount(h(ConnectFlow, { service: "spotify" }));
  await signIn(host);
  expect(login).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(document.activeElement).toBe(heading(host, "Importing")));
  await click(button(host, "Cancel"));
  await act(async () => {
    release.resolve();
    await held;
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(heading(host, "Sign in to Spotify")));
  expect(panel(host)?.textContent).toContain("Sync cancelled before it started.");
  expect(panel(host)?.textContent).not.toContain("Sign-in to Spotify cancelled.");
  expect(liveRegion(host).textContent).toBe("Sync cancelled before it started.");
  expect(recorded("spotify")).toBeNull();
});

it("shows the pre-run cancellation notice on the file panel without mentioning sign-in", async () => {
  const release = deferred<void>();
  const held = withConnectorLock(
    DEMO_ROOT,
    "netflix",
    new AbortController().signal,
    () => release.promise,
  );
  const { host } = await mount(h(ConnectFlow, { service: "netflix" }));
  await click(button(host, "Continue"));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing export input");
  Object.defineProperty(input, "files", {
    value: [new File(["Title,Date\n"], "NetflixViewingHistory.csv")],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await click(button(host, "Cancel"));
  await act(async () => {
    release.resolve();
    await held;
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(heading(host, "Import a file")));
  expect(panel(host)?.textContent).toContain("Sync cancelled before it started.");
  expect(liveRegion(host).textContent).toBe("Sync cancelled before it started.");
  expect(login).not.toHaveBeenCalled();
  expect(recorded("netflix")).toBeNull();
});
