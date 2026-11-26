// AUTHORED-BY Codex GPT-6.2-Sol
import { expect, it, vi } from "vitest";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { useOpenWithSheets } from "../src/apps/drive/state/open-with-sheets";
import { DriveUiProvider } from "../src/apps/drive/state/ui";
import { workbookHref } from "../src/apps/sheets/lib/routes";
import { PodSessionProvider, usePodSessionState } from "../src/lib/session/pod-session";
import { AccountsProvider, useAccounts } from "../src/shell/session/accounts-provider";
import type { SessionBackend, SuiteAccount } from "../src/shell/session/types";
import { act, deferred, mount } from "./drive-ui-dom";

const { push, create, success } = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@jeswr/suite-ui", async (original) => {
  const ui = await original<typeof import("@jeswr/suite-ui")>();
  return { ...ui, toast: Object.assign(vi.fn(), ui.toast, { success }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../src/apps/sheets/lib/workbook", () => ({
  createWorkbookService: () => ({ createFromCsv: create }),
}));
vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: async () => [],
}));

const alice: SuiteAccount = {
  id: "alice",
  kind: "solid",
  name: "Alice",
  webId: "https://pod.example/alice#me",
  storageUrl: "https://pod.example/alice/",
};
const csv = { kind: "file" as const, url: `${alice.storageUrl}budget.csv`, name: "budget.csv" };
const workbook = `${alice.storageUrl}sheets/budget/`;

async function startImport(next: SuiteAccount) {
  localStorage.clear();
  push.mockClear();
  success.mockClear();
  const result = deferred<{ container: string }>();
  create.mockReset().mockReturnValue(result.promise);
  let expire = () => {};
  const backend: SessionBackend = {
    kind: "solid",
    restore: async () => alice,
    signIn: async () => next,
    signOut: async () => {},
    onExpired: (listener) => {
      expire = listener;
      return () => {};
    },
    fetchFor: () => async () => new Response("a,b"),
  };
  let drive!: ReturnType<typeof useDrive>;
  let control: ReturnType<typeof useOpenWithSheets>;
  let accounts!: ReturnType<typeof useAccounts>;
  function Controller() {
    drive = useDrive();
    control = useOpenWithSheets(csv);
    return null;
  }
  function Drive() {
    accounts = useAccounts();
    const state = usePodSessionState();
    if (state.status !== "ready") return null;
    const { session } = state;
    return (
      <DriveProvider
        key={JSON.stringify([session.mode, session.webId, session.storageUrl])}
        session={session}
        provision={false}
      >
        <DriveUiProvider>
          <Controller />
        </DriveUiProvider>
      </DriveProvider>
    );
  }
  await mount(
    <AccountsProvider backends={[backend]}>
      <PodSessionProvider>
        <Drive />
      </PodSessionProvider>
    </AccountsProvider>,
  );
  const started = drive;
  const refreshed = vi.fn();
  started.changes.subscribe(workbook, refreshed);
  let pending: Promise<void> | undefined;
  await act(() => {
    pending = control?.run();
  });
  expect(create).toHaveBeenCalledOnce();
  return {
    started,
    current: () => drive,
    refreshed,
    switchAccount: () => accounts.signIn({ webId: next.webId }),
    expire,
    signOut: () => accounts.signOut(),
    finish: async () => {
      result.resolve({ container: workbook });
      await pending;
    },
  };
}

it("drops Alice's import after the Drive provider remounts for Bob", async () => {
  const bob = {
    ...alice,
    id: "bob",
    webId: "https://pod.example/bob#me",
    storageUrl: "https://pod.example/bob/",
  };
  const run = await startImport(bob);
  await act(run.switchAccount);
  expect(run.current().session.webId).toBe(bob.webId);
  expect(run.current().changes).not.toBe(run.started.changes);
  await act(run.finish);
  expect(push).not.toHaveBeenCalled();
  expect(run.refreshed).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledWith("Opened budget.csv with Sheets in your previous account");
});

it.each([
  ["storage", { ...alice, storageUrl: "https://pod.example/other/" }],
  ["WebID", { ...alice, id: "bob", webId: "https://pod.example/bob#me" }],
] as const)("checks the active %s even before React commits the account change", async (_field, next) => {
  const run = await startImport(next);
  await act(async () => {
    await run.switchAccount();
    expect(run.current()).toBe(run.started);
    await run.finish();
  });
  expect(push).not.toHaveBeenCalled();
  expect(run.refreshed).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledWith("Opened budget.csv with Sheets in your previous account");
});

it("opens the workbook when the same account refreshes its session during the import", async () => {
  const run = await startImport({ ...alice, name: "Alice Smith" });
  await act(run.switchAccount);
  expect(run.current().session).not.toBe(run.started.session);
  expect(run.current().changes).toBe(run.started.changes);
  await act(run.finish);
  expect(push).toHaveBeenCalledExactlyOnceWith(workbookHref(workbook));
  expect(run.refreshed).toHaveBeenCalledOnce();
});

it.each([
  "expire",
  "signOut",
] as const)("reports a completed import accurately when the session ends (%s)", async (endSession) => {
  const run = await startImport(alice);
  await act(async () => {
    await run[endSession]();
    await run.finish();
  });
  expect(push).not.toHaveBeenCalled();
  expect(run.refreshed).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledExactlyOnceWith("Imported budget.csv with Sheets", {
    description: "Sign in again to open the imported file.",
  });
});
