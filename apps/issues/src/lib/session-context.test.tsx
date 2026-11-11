// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred, fakePodAuth, identity, WEB_ID, POD_ROOT } from "@jeswr/app-session/testing";
import type { SessionProviderProps } from "@jeswr/app-session/react";
import { SolidSessionProvider, useSolidSession, type SolidSession } from "./session-context";

const { loadTracker, registerTracker, clearCaches, constructors } = vi.hoisted(() => ({
  loadTracker: vi.fn(),
  registerTracker: vi.fn(),
  clearCaches: vi.fn(),
  constructors: vi.fn(),
}));
vi.mock("./repository", () => ({
  Repository: class {
    constructor(...args: unknown[]) {
      constructors(...args);
    }
    loadTracker = loadTracker;
  },
}));
vi.mock("./type-index", () => ({ registerTracker }));
vi.mock("./issue-cache", () => ({ clearAllIssueCaches: clearCaches }));

let session: SolidSession;
function Probe() {
  const value = useSolidSession();
  useEffect(() => {
    session = value;
  }, [value]);
  return <div>{value.status}</div>;
}
let fake: ReturnType<typeof fakePodAuth>;
const profileReader = vi.fn<NonNullable<SessionProviderProps["readProfile"]>>(async (webId) => ({
  webId,
  name: "Alice",
  storages: ["https://unverified.example/"],
  oidcIssuers: [],
}));
function mount() {
  return render(
    <StrictMode>
      <SolidSessionProvider auth={fake.auth} readProfile={profileReader}>
        <Probe />
      </SolidSessionProvider>
    </StrictMode>,
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fake = fakePodAuth();
  fake.auth.restore.mockResolvedValue(identity);
  fake.auth.identity.mockResolvedValue(identity);
  loadTracker.mockResolvedValue({ exists: false });
  registerTracker.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("restores once in StrictMode and opens/registers only a verified root using auth.fetch", async () => {
  mount();
  await waitFor(() => expect(session.status).toBe("logged-in"));
  expect(fake.auth.restore).toHaveBeenCalledTimes(1);
  expect(session.profile).toEqual({ webId: WEB_ID, name: "Alice", storageUrls: [POD_ROOT] });
  expect(session.podFetch).toBe(fake.auth.fetch);
  expect(constructors).toHaveBeenCalledWith(
    `${POD_ROOT}issue-tracker/tracker.ttl`,
    fake.auth.fetch,
  );
  expect(registerTracker).toHaveBeenCalledWith(
    WEB_ID,
    POD_ROOT,
    session.trackerUrl,
    fake.auth.fetch,
  );
});

it("requires an explicit choice among verified storages and refuses an unlisted selection", async () => {
  const second = "https://other-storage.example/pod/";
  fake.auth.identity.mockResolvedValue({ ...identity, storages: [POD_ROOT, second] });
  mount();
  await waitFor(() => expect(session.status).toBe("choose-storage"));
  expect(session.storageChoices).toEqual([POD_ROOT, second]);
  await act(() => session.chooseStorage("https://unverified.example/"));
  expect(loadTracker).not.toHaveBeenCalled();
  await act(() => session.chooseStorage(second));
  expect(session.status).toBe("logged-in");
  expect(session.storageUrl).toBe(second);
});

it("does not use the shared display-origin fallback when no credential roots are verified", async () => {
  fake.auth.identity.mockResolvedValue({ ...identity, storages: [] });
  mount();
  await waitFor(() => expect(session.status).toBe("error"));
  expect(session.error).toContain("pim:storage");
  expect(loadTracker).not.toHaveBeenCalled();
});

it("reports safe tracker errors and retries provisioning without another restore", async () => {
  loadTracker.mockRejectedValueOnce(new Error("secret protocol detail"));
  mount();
  await waitFor(() => expect(session.status).toBe("error"));
  expect(session.error).toBe("We couldn't open your tracker. Try again.");
  act(() => session.retry());
  await waitFor(() => expect(session.status).toBe("logged-in"));
  expect(fake.auth.restore).toHaveBeenCalledTimes(1);
});

it.each([
  "logout",
  "expired",
] as const)("clears cached data on an external %s event", async (type) => {
  mount();
  await waitFor(() => expect(session.status).toBe("logged-in"));
  act(() => fake.emit(type, null));
  expect(session.profile).toBeNull();
  expect(session.trackerUrl).toBeNull();
  expect(clearCaches).toHaveBeenCalled();
});

it("fences a tracker read that completes after sign-out", async () => {
  const read = deferred<{ exists: boolean }>();
  loadTracker.mockReturnValue(read.promise);
  mount();
  await waitFor(() => expect(loadTracker).toHaveBeenCalled());
  await act(() => session.logout());
  await act(() => read.resolve({ exists: true }));
  expect(session.status).toBe("logged-out");
  expect(fake.auth.logout).toHaveBeenCalledTimes(1);
  expect(registerTracker).not.toHaveBeenCalled();
});

it("never publishes a previous account's delayed tracker load after account switching", async () => {
  const read = deferred<{ exists: boolean }>();
  loadTracker.mockReturnValueOnce(read.promise);
  mount();
  await waitFor(() => expect(loadTracker).toHaveBeenCalledTimes(1));
  const bob = {
    ...identity,
    webId: "https://bob.example/#me",
    storages: ["https://bob.example/pod/"],
  };
  fake.auth.identity.mockResolvedValue(bob);
  act(() => fake.emit("login", bob));
  await waitFor(() => expect(session.profile?.webId).toBe(bob.webId));
  await act(() => read.resolve({ exists: true }));
  expect(session.profile?.webId).toBe(bob.webId);
  expect(registerTracker).toHaveBeenCalledTimes(1);
  expect(clearCaches).toHaveBeenCalled();
});

it("removes exactly Issues' obsolete keys and keeps unrelated application data", async () => {
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  localStorage.setItem("solid:recent-accounts", "old");
  localStorage.setItem("unrelated", "keep");
  sessionStorage.setItem("solid-issues.autologin.flow", "old");
  sessionStorage.setItem("solid-issues.autologin-attempted", "old");
  sessionStorage.setItem("pod-docs:pss.autologin.flow", "keep");
  try {
    mount();
    await waitFor(() => expect(session.status).toBe("logged-in"));
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("solid-issues-auth");
    expect(localStorage.getItem("solid:recent-accounts")).toBeNull();
    expect(sessionStorage.getItem("solid-issues.autologin.flow")).toBeNull();
    expect(sessionStorage.getItem("solid-issues.autologin-attempted")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(sessionStorage.getItem("pod-docs:pss.autologin.flow")).toBe("keep");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("remembers a verified storage choice across provider remounts", async () => {
  const second = "https://other-storage.example/pod/";
  fake.auth.identity.mockResolvedValue({ ...identity, storages: [POD_ROOT, second] });
  const first = mount();
  await waitFor(() => expect(session.status).toBe("choose-storage"));
  await act(() => session.chooseStorage(second));
  first.unmount();
  mount();
  await waitFor(() => expect(session.status).toBe("logged-in"));
  expect(session.storageUrl).toBe(second);
});

it("rejects a saved choice that is absent from the current verified roots", async () => {
  const second = "https://other-storage.example/pod/";
  localStorage.setItem(`solid-issues:storage:${WEB_ID}`, "https://unverified.example/");
  fake.auth.identity.mockResolvedValue({ ...identity, storages: [POD_ROOT, second] });
  mount();
  await waitFor(() => expect(session.status).toBe("choose-storage"));
  expect(session.storageChoices).toEqual([POD_ROOT, second]);
  expect(loadTracker).not.toHaveBeenCalled();
});

it("keeps tracker setup usable when browser preferences are unavailable", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    mount();
    await waitFor(() => expect(session.status).toBe("logged-in"));
    expect(session.storageUrl).toBe(POD_ROOT);
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
