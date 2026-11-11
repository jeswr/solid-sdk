// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { createPodHttp, executeMigration, finalizePlan, planMigration } from "@jeswr/pod-migrator";
import {
  type ConnectionState,
  createConnection,
  inspectPod,
  type PodConnection,
} from "@jeswr/pod-migrator/connections";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { MigrationFlow, MovePodSettings } from "../src/shell/settings/move-pod";
import { deferred, h } from "./drive-ui-dom";
import { samplePlan, sourceRoot, targetRoot } from "./migrator-fixtures";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const accounts = vi.hoisted(() => ({ current: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => accounts.current }));
vi.mock("@jeswr/pod-migrator", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-migrator")>()),
  planMigration: vi.fn(),
  finalizePlan: vi.fn(),
  executeMigration: vi.fn(),
}));
vi.mock("@jeswr/pod-migrator/connections", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-migrator/connections")>()),
  createConnection: vi.fn(),
  inspectPod: vi.fn(),
}));

let state: ConnectionState;
const listeners = new Set<() => void>();
const target = {
  id: "target",
  auth: { publicFetch: vi.fn<typeof fetch>(), authenticatedFetch: vi.fn<typeof fetch>() },
  initialize: vi.fn(async () => {}),
  snapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  login: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  selectStorage: vi.fn(async () => {}),
  readProfile: vi.fn(async () => {}),
} as unknown as PodConnection;
const account = {
  id: "alice",
  kind: "solid" as const,
  name: "Alice",
  webId: "https://source.example/#me",
  storageUrl: sourceRoot,
};
const source = {
  root: sourceRoot,
  ownerWebId: account.webId,
  http: createPodHttp({ root: sourceRoot, fetch: vi.fn() }),
};

async function publish(next: Partial<ConnectionState>) {
  await act(async () => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", window.location);
  vi.stubGlobal("history", window.history);
  listeners.clear();
  sessionStorage.clear();
  state = {
    status: "connected",
    webId: "https://target.example/#me",
    roots: [targetRoot],
    root: targetRoot,
    implementation: "css",
    accessSystem: "wac",
    error: null,
  };
  accounts.current = {
    active: account,
    status: "ready",
    fetchFor: vi.fn(() => vi.fn()),
  } as unknown as AccountsContextValue;
  vi.mocked(createConnection).mockReturnValue(target);
  vi.mocked(inspectPod).mockImplementation(async (side) => side);
  vi.mocked(planMigration).mockResolvedValue(samplePlan);
  vi.mocked(finalizePlan).mockReturnValue({} as ReturnType<typeof finalizePlan>);
  vi.mocked(executeMigration).mockResolvedValue({
    copied: [`${targetRoot}notes.txt`],
    aclWritten: [],
    failed: [],
    skipped: [],
    log: [],
    verified: true,
    cancelled: false,
  });
});
afterEach(cleanup);

async function review() {
  render(h(MigrationFlow, { source, targetConnection: target }));
  fireEvent.click(screen.getByRole("button", { name: /Continue to target/ }));
  fireEvent.click(screen.getByRole("button", { name: /Continue to options/ }));
  fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
  await screen.findByRole("button", { name: "Start migration" });
}

it("hides migration controls and authentication for demo accounts", () => {
  accounts.current.active = { ...account, kind: "demo" };
  render(h(MovePodSettings));
  expect(screen.getByText(/needs a real pod/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(createConnection).not.toHaveBeenCalled();
  expect(accounts.current.fetchFor).not.toHaveBeenCalled();
});

it("pins the source to the active account and uses an independent destination client", async () => {
  render(h(MovePodSettings));
  await screen.findByRole("heading", { name: "Source pod" });
  expect(accounts.current.fetchFor).toHaveBeenCalledWith(account);
  expect(inspectPod).toHaveBeenCalledWith(
    expect.objectContaining({ root: account.storageUrl, ownerWebId: account.webId }),
    expect.any(AbortSignal),
  );
  expect(createConnection).toHaveBeenCalledWith(
    "target",
    location.origin,
    "/settings/move-pod/",
    new URL("/.well-known/solid-client-id.jsonld", location.origin).href,
  );
  expect(screen.getByText(account.webId)).toBeTruthy();
});

it("shows destination restore, sign-in, loading, storage selection and error states", async () => {
  state = { ...state, status: "restoring", root: null, webId: null };
  render(h(MigrationFlow, { source, targetConnection: target }));
  expect(screen.getByText("Restoring your sign-in…")).toBeTruthy();
  await publish({ status: "signed-out" });
  fireEvent.change(screen.getByRole("textbox", { name: "WebID URL" }), {
    target: { value: "https://target.example/#me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in to target" }));
  expect(target.login).toHaveBeenCalledWith("https://target.example/#me", "webid");
  fireEvent.click(screen.getByRole("button", { name: "Inrupt PodSpaces" }));
  expect(target.login).toHaveBeenCalledWith("https://login.inrupt.com", "issuer");
  await publish({ status: "loading" });
  expect(screen.getByText("Connecting to your account…")).toBeTruthy();
  await publish({
    status: "choose-storage",
    webId: "https://target.example/#me",
    roots: [targetRoot, "https://target.example/other/"],
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Choose storage" }), {
    target: { value: targetRoot },
  });
  expect(target.selectStorage).toHaveBeenCalledWith(targetRoot);
  await publish({ status: "error", error: "Could not connect" });
  expect(screen.getByRole("alert").textContent).toBe("Could not connect");
  fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
  expect(target.readProfile).toHaveBeenCalled();
});

it("requires every decision and review acceptance before executing and reporting", async () => {
  await review();
  const start = screen.getByRole("button", { name: "Start migration" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  for (const radio of screen.getAllByLabelText(/Leave out the group grant/)) fireEvent.click(radio);
  expect(start.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  await screen.findByRole("heading", { name: "Migration finished" });
  expect(finalizePlan).toHaveBeenCalledWith(samplePlan, {
    owner: "acknowledge",
    friends: "skip",
    colleagues: "skip",
  });
  expect(executeMigration).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ source, target: expect.objectContaining({ root: targetRoot }) }),
  );
  expect(screen.getByText("Verification passed")).toBeTruthy();
});

it("blocks abort choices even after accepting review and resets acceptance on choice changes", async () => {
  await review();
  for (const radio of screen.getAllByLabelText(/Leave out the group grant/)) fireEvent.click(radio);
  const accepted = screen.getByRole("checkbox", { name: /I have reviewed/ }) as HTMLInputElement;
  fireEvent.click(accepted);
  fireEvent.click(screen.getAllByLabelText(/Stop the migration/)[0] as HTMLElement);
  expect(accepted.checked).toBe(false);
  fireEvent.click(accepted);
  expect(
    (screen.getByRole("button", { name: "Start migration" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(executeMigration).not.toHaveBeenCalled();
});

it("invalidates the plan when destination credentials or storage change", async () => {
  await review();
  await publish({ root: "https://target.example/new/", roots: ["https://target.example/new/"] });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Start migration" })).toBeNull());
  expect(executeMigration).not.toHaveBeenCalled();
});

it("requires a fresh acceptance whenever a new plan is prepared", async () => {
  await review();
  for (const radio of screen.getAllByLabelText(/Leave out the group grant/)) fireEvent.click(radio);
  fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Back to options" }));
  fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
  await screen.findByRole("button", { name: "Start migration" });
  expect(
    (screen.getByRole("checkbox", { name: /I have reviewed/ }) as HTMLInputElement).checked,
  ).toBe(false);
  expect(
    (screen.getByRole("button", { name: "Start migration" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("discards a planning result after cancellation without starting writes", async () => {
  const pending = deferred<Awaited<ReturnType<typeof planMigration>>>();
  vi.mocked(planMigration).mockReturnValueOnce(pending.promise);
  render(h(MigrationFlow, { source, targetConnection: target }));
  fireEvent.click(screen.getByRole("button", { name: /Continue to target/ }));
  fireEvent.click(screen.getByRole("button", { name: /Continue to options/ }));
  fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel planning" }));
  expect(vi.mocked(planMigration).mock.calls[0]?.[0].signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(samplePlan);
  });
  expect(screen.queryByRole("button", { name: "Start migration" })).toBeNull();
  expect(screen.getByRole("button", { name: /Create migration plan/ })).toBeTruthy();
  expect(executeMigration).not.toHaveBeenCalled();
});

it("keeps a safe finalization refusal visible and never executes", async () => {
  await review();
  for (const radio of screen.getAllByLabelText(/Leave out the group grant/)) fireEvent.click(radio);
  fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
  vi.mocked(finalizePlan).mockImplementationOnce(() => {
    throw new Error("unsafe");
  });
  fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
  expect(screen.getByRole("alert").textContent).toContain("cannot run safely");
  expect(executeMigration).not.toHaveBeenCalled();
});

it("cancels execution and displays the engine's partial report", async () => {
  const pending = deferred<Awaited<ReturnType<typeof executeMigration>>>();
  vi.mocked(executeMigration).mockReturnValueOnce(pending.promise);
  await review();
  for (const radio of screen.getAllByLabelText(/Leave out the group grant/)) fireEvent.click(radio);
  fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel migration" }));
  expect(vi.mocked(executeMigration).mock.calls[0]?.[1].signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve({
      copied: [`${targetRoot}notes.txt`],
      aclWritten: [],
      failed: [],
      skipped: [],
      log: [],
      verified: false,
      cancelled: true,
    });
  });
  await screen.findByRole("heading", { name: "Migration cancelled" });
  expect(screen.getByText("Verification has not passed")).toBeTruthy();
  expect(
    JSON.parse(sessionStorage.getItem("pod-migrator:run-report:v1") ?? "null").result.cancelled,
  ).toBe(true);
});
