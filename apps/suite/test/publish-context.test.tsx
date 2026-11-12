// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { PublicationError, type PublishRepository, type StoredSite } from "@jeswr/solid-publish";
import { toast } from "@jeswr/suite-ui";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectPublish } from "../src/apps/publish/lib/data/connect";
import { PublishProvider, usePublish } from "../src/apps/publish/state/publish-context";
import { STALE_ACCOUNT_FAILURE } from "../src/apps/publish/state/workspace";
import type { PodSession } from "../src/lib/session/pod-session";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";

vi.mock("../src/apps/publish/lib/data/connect", () => ({ connectPublish: vi.fn() }));
const session: PodSession = {
  mode: "demo",
  webId: "https://pod.example/me",
  displayName: "Robin Fiction",
  storageUrl: "https://pod.example/",
  fetch: globalThis.fetch,
  subscribe: () => () => {},
  reset: async () => {},
};
function Child() {
  const { snapshot, session } = usePublish();
  return (
    <p>
      {session.displayName}:{snapshot.status}
    </p>
  );
}
function TriggerFailure() {
  const { workspace } = usePublish();
  return (
    <button
      type="button"
      onClick={() => {
        void workspace.reorder("missing-site", []);
      }}
    >
      Fail write
    </button>
  );
}
const siteData = {
  name: "Late",
  description: "",
  author: "Writer",
  theme: "paper" as const,
  inLanguage: "en",
  created: new Date(),
  modified: new Date(),
};
/** A repository whose createSite stays pending until the test rejects it. */
function pendingRepository() {
  const repo = repository();
  const control: { fail: (cause: Error) => void } = { fail: () => {} };
  repo.createSite = vi.fn(
    () =>
      new Promise<StoredSite>((_resolve, reject) => {
        control.fail = reject;
      }),
  );
  return { repo, control };
}
function fallback(error: boolean, retry: () => void) {
  return (
    <button type="button" onClick={retry}>
      {error ? "retry connection" : "connecting"}
    </button>
  );
}
function repository() {
  return {
    listSites: vi.fn(async () => ({ items: [], invalid: [] })),
    listPages: vi.fn(async () => ({ items: [], invalid: [] })),
  } as unknown as PublishRepository;
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe("Publish React session context", () => {
  it("requires its provider", () => expect(() => renderToString(<Child />)).toThrow(/provider/));
  it("opens a connected workspace in StrictMode", async () => {
    vi.mocked(connectPublish).mockResolvedValue(repository());
    await act(async () =>
      root.render(
        <StrictMode>
          <PublishProvider session={session} fallback={fallback}>
            <Child />
          </PublishProvider>
        </StrictMode>,
      ),
    );
    expect(host.textContent).toBe("Robin Fiction:ready");
  });
  it("shows connection failures and retries", async () => {
    vi.mocked(connectPublish)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(repository());
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={fallback}>
          <Child />
        </PublishProvider>,
      ),
    );
    expect(host.textContent).toBe("retry connection");
    await act(async () => host.querySelector("button")?.click());
    expect(host.textContent).toBe("Robin Fiction:ready");
    expect(connectPublish).toHaveBeenCalledTimes(2);
  });
  it("preserves the unsupported-access message at the connection boundary", async () => {
    vi.mocked(connectPublish).mockRejectedValueOnce(
      new PublicationError("This pod's access control isn't supported by Publish yet."),
    );
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={(_error, _retry, message) => <p>{message}</p>}>
          <Child />
        </PublishProvider>,
      ),
    );
    expect(host.textContent).toContain("This pod's access control isn't supported by Publish yet.");
  });
  it("warns while writes are pending, including after route unmount, and removes the warning on completion", async () => {
    const repo = repository();
    let finish!: () => void;
    repo.createSite = vi.fn(
      (key, data) =>
        new Promise<StoredSite>((resolve) => {
          finish = () =>
            resolve({ url: `https://pod.example/publish/${key}/site.ttl`, etag: '"1"', data });
        }),
    );
    vi.mocked(connectPublish).mockResolvedValue(repo);
    let workspace!: ReturnType<typeof usePublish>["workspace"];
    function Capture() {
      workspace = usePublish().workspace;
      return <p>ready</p>;
    }
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={fallback}>
          <Capture />
        </PublishProvider>,
      ),
    );
    const now = new Date();
    let saved!: Promise<boolean>;
    await act(async () => {
      saved = workspace.createSite("new", {
        name: "New",
        description: "",
        author: "Writer",
        theme: "paper",
        inLanguage: "en",
        created: now,
        modified: now,
      }).saved;
    });
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const anchor = document.createElement("a");
    anchor.href = "/elsewhere";
    document.body.append(anchor);
    expect(anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
      false,
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("still saving"));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    }
    anchor.target = "_blank";
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    anchor.target = "_self";
    anchor.href = `${window.location.href.split("#")[0]}#preview`;
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(confirm).toHaveBeenCalledTimes(1);

    anchor.remove();
    confirm.mockRestore();
    await act(async () => root.render(<p>Another route</p>));
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    finish();
    expect(await saved).toBe(true);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("sends a failed write to the global toast after navigating to another route", async () => {
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("late-error");
    const repo = repository();
    let fail!: (cause: Error) => void;
    repo.createSite = vi.fn(
      () =>
        new Promise<StoredSite>((_resolve, reject) => {
          fail = reject;
        }),
    );
    vi.mocked(connectPublish).mockResolvedValue(repo);
    let workspace!: ReturnType<typeof usePublish>["workspace"];
    function Capture() {
      workspace = usePublish().workspace;
      return <p>ready</p>;
    }
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={fallback}>
          <Capture />
        </PublishProvider>,
      ),
    );
    const now = new Date();
    let saving!: Promise<boolean>;
    await act(async () => {
      saving = workspace.createSite("late", {
        name: "Late",
        description: "",
        author: "Writer",
        theme: "paper",
        inLanguage: "en",
        created: now,
        modified: now,
      }).saved;
    });
    await act(async () => root.render(<p>Another route</p>));
    fail(new PublicationError("Your site could not be saved."));
    expect(await saving).toBe(false);
    expect(host.textContent).toBe("Another route");
    expect(errorToast).toHaveBeenCalledWith("Your site could not be saved.");
    errorToast.mockRestore();
  });
  it("never shows a late connection from an earlier account", async () => {
    let finish!: (repo: PublishRepository) => void;
    vi.mocked(connectPublish)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(repository());
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={fallback}>
          <Child />
        </PublishProvider>,
      ),
    );
    expect(host.textContent).toBe("connecting");
    const second = { ...session, webId: "https://other.example/me", displayName: "Another writer" };
    await act(async () =>
      root.render(
        <PublishProvider session={second} fallback={fallback}>
          <Child />
        </PublishProvider>,
      ),
    );
    expect(host.textContent).toBe("Another writer:ready");
    await act(async () => finish(repository()));
    expect(host.textContent).toBe("Another writer:ready");
  });
  it("ignores a failed connection after the account changes and reports write failures through toast", async () => {
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("test-toast");
    let reject!: (error: unknown) => void;
    vi.mocked(connectPublish)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, no) => {
            reject = no;
          }),
      )
      .mockResolvedValueOnce(repository());
    await act(async () =>
      root.render(
        <PublishProvider session={session} fallback={fallback}>
          <Child />
        </PublishProvider>,
      ),
    );
    const second = {
      ...session,
      webId: "https://another.example/me",
      displayName: "Another writer",
    };
    await act(async () =>
      root.render(
        <PublishProvider session={second} fallback={fallback}>
          <Child />
        </PublishProvider>,
      ),
    );
    await act(async () => reject(new Error("late failure")));
    expect(host.textContent).toBe("Another writer:ready");
    await act(async () =>
      root.render(
        <PublishProvider session={second} fallback={fallback}>
          <Child />
          <TriggerFailure />
        </PublishProvider>,
      ),
    );
    await act(async () => host.querySelector("button")?.click());
    expect(errorToast).toHaveBeenCalledWith(expect.stringContaining("site"));
    errorToast.mockRestore();
  });
  it("hides a late failure's pod URLs after the shell switches account away from Publish", async () => {
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("stale");
    const live = { id: "account-a", version: 1 };
    const accounts = {
      active: { id: "account-a" },
      sessionVersion: 1,
      isActiveAccount: (id: string, version?: number) => id === live.id && version === live.version,
    } as unknown as AccountsContextValue;
    const { repo, control } = pendingRepository();
    vi.mocked(connectPublish).mockResolvedValue(repo);
    let workspace!: ReturnType<typeof usePublish>["workspace"];
    function Capture() {
      workspace = usePublish().workspace;
      return <p>ready</p>;
    }
    await act(async () =>
      root.render(
        <AccountsContext value={accounts}>
          <PublishProvider session={session} fallback={fallback}>
            <Capture />
          </PublishProvider>
        </AccountsContext>,
      ),
    );
    let saving!: Promise<boolean>;
    await act(async () => {
      saving = workspace.createSite("late", siteData).saved;
    });
    await act(async () => root.render(<p>Another route</p>));
    Object.assign(live, { id: "account-b", version: 2 });
    control.fail(
      new PublicationError("Couldn't read permissions for https://pod.example/publish/."),
    );
    expect(await saving).toBe(false);
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(STALE_ACCOUNT_FAILURE);
    expect(JSON.stringify(errorToast.mock.calls)).not.toContain("pod.example");
    errorToast.mockRestore();
  });
  it("hides a late failure's pod URLs after a standalone session changes account", async () => {
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("stale");
    const { repo, control } = pendingRepository();
    vi.mocked(connectPublish).mockResolvedValueOnce(repo).mockResolvedValueOnce(repository());
    let workspace!: ReturnType<typeof usePublish>["workspace"];
    function Capture() {
      workspace = usePublish().workspace;
      return <p>{usePublish().session.displayName}</p>;
    }
    await act(async () =>
      root.render(
        <PublishProvider key="a" session={session} fallback={fallback}>
          <Capture />
        </PublishProvider>,
      ),
    );
    let saving!: Promise<boolean>;
    await act(async () => {
      saving = workspace.createSite("late", siteData).saved;
    });
    const second = { ...session, webId: "https://other.example/me", displayName: "Another writer" };
    await act(async () =>
      root.render(
        <PublishProvider key="b" session={second} fallback={fallback}>
          <Capture />
        </PublishProvider>,
      ),
    );
    expect(host.textContent).toBe("Another writer");
    control.fail(
      new PublicationError("Couldn't read permissions for https://pod.example/publish/."),
    );
    expect(await saving).toBe(false);
    expect(errorToast).toHaveBeenCalledExactlyOnceWith(STALE_ACCOUNT_FAILURE);
    errorToast.mockRestore();
  });
});
