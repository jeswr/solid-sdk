// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { allowDrafts, legacyDraftKey, saveDraft } from "../src/feedback/draft";
import { FeedbackDraftCleanup } from "../src/feedback/draft-cleanup";
import { FeedbackPage } from "../src/feedback/feedback-page";
import { AccountsContext } from "../src/shell/session/accounts-context";
import { beforeSignOut } from "../src/shell/session/sign-out-cleanup";

const voice = vi.hoisted(() => ({ onClip: undefined as undefined | ((clip: unknown) => void) }));
vi.mock("../src/feedback/speech", () => ({
  voiceInThisBuild: true,
  useVoice: (_onText: unknown, onClip: (clip: unknown) => void) => {
    voice.onClip = onClip;
    return {
      supported: true,
      listening: false,
      starting: false,
      error: "",
      start: vi.fn(),
      stop: vi.fn(),
    };
  },
}));
const download = vi.hoisted(() => ({
  feedbackArchive: vi.fn(async () => new Uint8Array([1])),
  saveFeedbackArchive: vi.fn(async () => true),
}));
vi.mock("../src/feedback/download", () => download);

const submissionId = "11111111-1111-4111-8111-111111111111";
const now = Date.now();
const receipt = (expiry = now + 2 * 3_600_000, sha = "a".repeat(40)) => ({
  submissionId,
  sha,
  size: 4,
  ext: "webm" as const,
  sig: `${expiry}.${"b".repeat(64)}`,
});
const record = (audio?: number[]) =>
  JSON.stringify({
    pathway: "quick",
    answers: { general: "Private story" },
    transcript: [
      { role: "assistant", content: "Tell us" },
      { role: "user", content: "Private story", ...(audio ? { audio } : {}) },
    ],
    contact: { name: "Alice Example", email: "alice@example.test" },
    metadata: { version: "preview", commit: "", userAgent: "test", walkthrough: [] },
  });
const draftKey = (owner: string) => `suite.feedback.draft.v2:${owner}`;
const stored = (owner: string) => window.localStorage.getItem(draftKey(owner));
const seed = (
  owner: string,
  audio?: number[],
  receipts: unknown[] = [],
  at = Date.now(),
  uncertain = true,
) =>
  saveDraft(
    window.localStorage,
    owner,
    { submissionId, record: record(audio), uncertain, receipts: receipts as never },
    at,
  );
const alice = {
  id: "alice",
  webId: "https://pod.test/alice#me",
  name: "Alice",
  storageUrl: "https://pod.test/",
  kind: "solid" as const,
};
const accounts = (active: typeof alice | null, status = "ready") =>
  ({ active, status, accounts: active ? [active] : [] }) as never;
const view = (active: typeof alice | null = alice, status = "ready") =>
  render(
    <AccountsContext.Provider value={accounts(active, status)}>
      <FeedbackDraftCleanup />
      <FeedbackPage />
    </AccountsContext.Provider>,
  );

type Reply = Response | (() => Response | Promise<Response>);
const routes = { audio: [] as Reply[], submit: [] as Reply[] };
const calls: { path: string; method: string; body?: string | undefined }[] = [];
const next = async (queue: Reply[]) => {
  const reply = queue.length > 1 ? queue.shift() : queue[0];
  return typeof reply === "function" ? reply() : (reply as Response);
};
const clip = () => ({ blob: new Blob(["abcd"], { type: "audio/webm" }), text: "" });
const okReceipt = () => Response.json({ ...receipt(), submissionId: sentId() });
let started = "";
const sentId = () => started || submissionId;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  for (const owner of ["account:alice", "account:bob", "signed-out"]) allowDrafts(owner);
  routes.audio = [okReceipt];
  routes.submit = [Response.json({ reference: 9 })];
  calls.length = 0;
  started = "";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input), "https://suite.test").pathname;
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? String(init.body) : undefined,
    });
    if (path === "/api/feedback/turn") return Response.json({ hosted: false });
    if (path === "/api/feedback/audio") {
      started = new URL(String(input), "https://suite.test").searchParams.get("submissionId") ?? "";
      return next(routes.audio);
    }
    return next(routes.submit);
  });
  download.feedbackArchive.mockClear();
  download.saveFeedbackArchive.mockClear();
  download.saveFeedbackArchive.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const submits = () => calls.filter((c) => c.path === "/api/feedback/submit");
const sentBody = (index = 0) => JSON.parse(submits()[index]?.body ?? "null");
const button = (name: RegExp | string) => screen.getByRole("button", { name });
async function startQuick(text = "My answer") {
  await waitFor(() => expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button("Just tell us"));
  fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: text } });
}
async function press(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(button(name));
  });
}
async function attachClip() {
  await act(async () => {
    voice.onClip?.(clip());
  });
  await waitFor(() => expect(calls.some((c) => c.path === "/api/feedback/audio")).toBe(true));
  await waitFor(() => expect(screen.queryByText("Saving recording...")).toBeNull());
}

const textarea = () => screen.getByLabelText("Your answer") as HTMLTextAreaElement;
const failure =
  (status: number, code?: string, headers: Record<string, string> = {}) =>
  () =>
    Response.json({ error: "x", ...(code ? { code } : {}) }, { status, headers });
const frozen = () => textarea().readOnly;
const statusText = () =>
  screen
    .getAllByRole("status")
    .map((element) => element.textContent)
    .join(" | ");

describe("draft ownership and restore (M2)", () => {
  it("asks before restoring, and shows none of the draft until the person chooses", async () => {
    seed("account:alice");
    view();
    const heading = await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByText(/Private story/)).toBeNull();
    expect(document.body.textContent).not.toContain("alice@example.test");
    await waitFor(() => expect(calls.some((c) => c.path === "/api/feedback/turn")).toBe(true));
    expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Guided interview") as HTMLButtonElement).disabled).toBe(true);
  });
  it("restores the frozen record read-only after Restore it", async () => {
    seed("account:alice");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    expect(await screen.findByText("Private story")).toBeTruthy();
    expect((screen.getByLabelText("Name (optional)") as HTMLInputElement).value).toBe(
      "Alice Example",
    );
    expect((screen.getByLabelText("Name (optional)") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
  });
  it("discards the draft on request", async () => {
    seed("account:alice");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Discard it"));
    expect(stored("account:alice")).toBeNull();
    await waitFor(() => expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(false));
  });
  it("does not offer or restore one account's draft to another account or when signed out", async () => {
    seed("account:alice");
    const bob = { ...alice, id: "bob" };
    const { unmount } = view(bob);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/feedback/turn")).toBe(true));
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    expect(document.body.textContent).not.toContain("Private story");
    unmount();
    view(null);
    await waitFor(() => expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    // The owner's draft is untouched by other people looking.
    expect(stored("account:alice")).not.toBeNull();
  });
  it("keeps a signed-out draft in its own bucket", async () => {
    seed("signed-out");
    view(null);
    expect(
      await screen.findByRole("heading", { name: "Restore your unsent feedback?" }),
    ).toBeTruthy();
  });
  it("switching account in an open page restores nothing under the new account", async () => {
    seed("account:alice");
    const bob = { ...alice, id: "bob" };
    const { rerender } = view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    rerender(
      <AccountsContext.Provider value={accounts(bob)}>
        <FeedbackDraftCleanup />
        <FeedbackPage />
      </AccountsContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull(),
    );
    expect(document.body.textContent).not.toContain("Private story");
  });
  it("waits for the account to load before looking for a draft", async () => {
    seed("signed-out");
    seed("account:alice");
    view(alice, "loading");
    expect(screen.getByRole("status").textContent).toContain("Loading your account");
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    expect(stored("account:alice")).not.toBeNull();
  });
  it("never restores the old unowned draft and removes it", async () => {
    window.localStorage.setItem(
      legacyDraftKey,
      JSON.stringify({ submissionId, record: record(), receipts: [] }),
    );
    view();
    await waitFor(() => expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    expect(window.localStorage.getItem(legacyDraftKey)).toBeNull();
  });
  it("does not offer an expired draft and removes it", async () => {
    seed("account:alice", undefined, [], Date.now() - 25 * 3_600_000);
    view();
    await waitFor(() => expect((button("Just tell us") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    expect(stored("account:alice")).toBeNull();
  });
  it("discards a draft whose record is invalid and says so", async () => {
    saveDraft(window.localStorage, "account:alice", {
      submissionId,
      record: "{}",
      uncertain: true,
      receipts: [],
    });
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await waitFor(() => expect(statusText()).toContain("couldn't be restored"));
    expect(stored("account:alice")).toBeNull();
  });
  it("clears the account's draft on sign-out, but not another account's", async () => {
    seed("account:alice");
    seed("account:bob");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    await beforeSignOut(alice);
    expect(stored("account:alice")).toBeNull();
    expect(stored("account:bob")).not.toBeNull();
  });
  it("saves a failed submission under the account and clears it on sign-out", async () => {
    routes.submit = [failure(502)];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    await waitFor(() => expect(stored("account:alice")).not.toBeNull());
    expect(window.localStorage.getItem(legacyDraftKey)).toBeNull();
    expect(stored("signed-out")).toBeNull();
    await beforeSignOut(alice);
    expect(stored("account:alice")).toBeNull();
  });
  it("keeps working when browser storage is blocked", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    view();
    await startQuick();
    await press("Submit what I've said so far");
    await waitFor(() => expect(statusText()).toContain("#9"));
    getItem.mockRestore();
  });
});

describe("recordings that cannot be renewed (M3)", () => {
  it("tells the person plainly after a reload that the recordings are gone, and blocks a doomed submit", async () => {
    seed("account:alice", [0], []);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    expect(await screen.findByRole("heading", { name: "Recordings can't be sent" })).toBeTruthy();
    const panel = screen.getByRole("heading", { name: "Recordings can't be sent" }).parentElement;
    expect(panel?.textContent).toContain("can no longer be sent");
    expect(panel?.textContent).toContain("may receive this feedback twice");
    expect((button("Submit") as HTMLButtonElement).disabled).toBe(true);
    expect(submits()).toHaveLength(0);
  });
  it("submits without the recordings under a new submission id", async () => {
    seed("account:alice", [0], []);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByRole("heading", { name: "Recordings can't be sent" });
    await press("Submit without recordings");
    await waitFor(() => expect(statusText()).toContain("#9"));
    const body = sentBody();
    expect(body.submissionId).not.toBe(submissionId);
    expect(body.receipts).toEqual([]);
    expect(JSON.stringify(body.record)).not.toContain('"audio"');
    expect(body.record.answers.general).toBe("Private story");
    expect(stored("account:alice")).toBeNull();
  });
  it("lets the person remove the recordings and keep editing", async () => {
    seed("account:alice", [0], []);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByRole("heading", { name: "Recordings can't be sent" });
    await press("Remove recordings and record again");
    expect(screen.queryByRole("heading", { name: "Recordings can't be sent" })).toBeNull();
    expect(frozen()).toBe(false);
    expect(statusText()).toContain("Recordings removed");
    expect(stored("account:alice")).toBeNull();
    fireEvent.change(textarea(), { target: { value: "More detail" } });
    await press("Submit what I've said so far");
    await waitFor(() => expect(submits()).toHaveLength(1));
    const body = sentBody();
    expect(body.submissionId).not.toBe(submissionId);
    expect(JSON.stringify(body.record)).not.toContain('"audio"');
  });
  it.each([
    ["an expired receipt", [receipt(Date.now() - 1)]],
    ["a receipt about to expire", [receipt(Date.now() + 5 * 60_000)]],
    ["a corrupt receipt", [{ sha: "bad" }]],
    ["a missing receipt", [null]],
  ])("treats %s as gone", async (_name, receipts) => {
    seed("account:alice", [0], receipts);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    expect(await screen.findByRole("heading", { name: "Recordings can't be sent" })).toBeTruthy();
  });
  it("does not compact sparse receipts: a missing earlier recording is gone, not shifted", async () => {
    seed("account:alice", [1], [null, receipt()]);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    expect(await screen.findByRole("heading", { name: "Recordings can't be sent" })).toBeTruthy();
    expect(submits()).toHaveLength(0);
  });
  it("sends valid restored receipts by position and words a busy answer truthfully", async () => {
    routes.submit = [failure(503, "storage_busy", { "Retry-After": "30" })];
    seed("account:alice", [0], [receipt()]);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByText("Private story");
    expect(screen.queryByRole("heading", { name: "Recordings can't be sent" })).toBeNull();
    await press(/^Submit/);
    const alert = await screen.findByRole("alert");
    expect(sentBody().receipts).toEqual([receipt()]);
    expect(sentBody().submissionId).toBe(submissionId);
    expect(alert.textContent).toContain("Your answers are still here");
    expect(alert.textContent).not.toContain("recordings are still here");
  });
  it("makes Download say when recordings are not included", async () => {
    seed("account:alice", [0, 1], []);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByText("Private story");
    await press("Download my feedback");
    await waitFor(() =>
      expect(statusText()).toContain(
        "without recordings 1, 2: the audio is no longer in this browser",
      ),
    );
  });
  it("does not add a warning when every recording is in the download", async () => {
    view();
    await startQuick();
    await attachClip();
    await press("Download my feedback");
    await waitFor(() => expect(download.saveFeedbackArchive).toHaveBeenCalled());
    expect(document.body.textContent).not.toContain("Downloaded your answers");
  });
  it("reports a cancelled save", async () => {
    download.saveFeedbackArchive.mockResolvedValue(false);
    view();
    await startQuick();
    await press("Download my feedback");
    expect((await screen.findByRole("alert")).textContent).toContain("The save was cancelled");
  });
  it("reports a failed download", async () => {
    download.feedbackArchive.mockRejectedValueOnce(new Error("zip"));
    view();
    await startQuick();
    await press("Download my feedback");
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't be created");
  });
});

describe("classified failures (M5, L6)", () => {
  it.each([
    [
      "a limiter 429 that never reached storage",
      failure(429, "rate_limited", { "Retry-After": "60" }),
      "allowance",
      false,
    ],
    ["storage not switched on", failure(503, "unavailable"), "isn't available", false],
    [
      "a lost connection",
      () => Promise.reject(new TypeError("network")) as never,
      "couldn't submit",
      true,
    ],
    ["a server error", failure(502), "couldn't submit", true],
    ["a busy store", failure(503, "storage_busy", { "Retry-After": "30" }), "busy", true],
  ])("%s: shows the right message and sets uncertainty only when storage may be reached", async (_name, reply, text, uncertain) => {
    routes.submit = [reply as Reply, failure(400, "invalid")];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    expect((await screen.findByRole("alert")).textContent).toContain(text);
    expect(frozen()).toBe(true);
    await press(/^Submit/);
    await waitFor(() => expect(submits()).toHaveLength(2));
    // A later rejection may unfreeze the record only if no earlier answer could have stored it.
    await waitFor(() => expect(frozen()).toBe(uncertain));
    expect(stored("account:alice") === null).toBe(!uncertain);
  });
  it.each([
    ["a 400", failure(400, "invalid"), "email address"],
    ["a 413", failure(413, "too_large"), "too large"],
    ["a 415", failure(415, "unsupported"), "format the server accepts"],
  ])("%s on a first attempt unfreezes the record and clears the draft", async (_name, reply, text) => {
    routes.submit = [reply as Reply];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    expect((await screen.findByRole("alert")).textContent).toContain(text);
    await waitFor(() => expect(frozen()).toBe(false));
    expect(stored("account:alice")).toBeNull();
  });
  it("shows a conflict as permanent and never as try again", async () => {
    routes.submit = [failure(409, "conflict")];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already used for different feedback");
    expect(alert.textContent).not.toMatch(/try again/i);
    expect(frozen()).toBe(true);
  });
  it("clears stale receipts on a receipt-caused 400 and uploads the recordings again", async () => {
    routes.submit = [failure(400, "receipts_invalid"), Response.json({ reference: 9 })];
    view();
    await startQuick();
    await attachClip();
    await press("Submit what I've said so far");
    expect((await screen.findByRole("alert")).textContent).toContain("upload them again");
    expect(screen.queryByText(/email address/)).toBeNull();
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(1);
    await press(/^Submit/);
    await waitFor(() => expect(statusText()).toContain("#9"));
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(2);
    expect(sentBody(1).receipts).toHaveLength(1);
  });
  it("on a receipt-caused 400 after a reload reports the recordings as gone", async () => {
    routes.submit = [failure(400, "receipts_invalid")];
    seed("account:alice", [0], [receipt()]);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByText("Private story");
    await press(/^Submit/);
    expect(await screen.findByRole("heading", { name: "Recordings can't be sent" })).toBeTruthy();
    expect((button("Submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not retry an audio upload after a definite rejection", async () => {
    routes.audio = [failure(400, "invalid")];
    view();
    await startQuick();
    await act(async () => {
      voice.onClip?.(clip());
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("A recording was rejected"),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(1);
  });
  it.each([
    ["413", failure(413, "too_large")],
    ["415", failure(415, "unsupported")],
    ["a limiter 429", failure(429, "rate_limited", { "Retry-After": "60" })],
    ["a busy store", failure(503, "storage_busy", { "Retry-After": "30" })],
  ])("does not retry an audio upload after %s", async (_name, reply) => {
    routes.audio = [reply];
    view();
    await startQuick();
    await act(async () => {
      voice.onClip?.(clip());
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(1);
  });
  it("retries an upload once after an uncertain failure", async () => {
    routes.audio = [failure(502), okReceipt];
    view();
    await startQuick();
    await attachClip();
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports an upload that fails twice, keeping the audio", async () => {
    routes.audio = [failure(502)];
    view();
    await startQuick();
    await act(async () => {
      voice.onClip?.(clip());
    });
    await waitFor(
      () => expect(screen.getByRole("alert").textContent).toContain("Your audio is still here"),
      {
        timeout: 3000,
      },
    );
    expect(calls.filter((c) => c.path === "/api/feedback/audio")).toHaveLength(2);
  });
  it("does not make a rejected upload during Submit look like a stored record", async () => {
    routes.audio = [okReceipt, failure(400, "invalid")];
    routes.submit = [Response.json({ reference: 9 })];
    view();
    await startQuick();
    await attachClip();
    // The receipt is fine now; expire it so Submit uploads again and that upload is rejected.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 3_600_000);
    await press("Submit what I've said so far");
    expect(await screen.findByRole("heading", { name: "Recordings can't be sent" })).toBeTruthy();
    expect(submits()).toHaveLength(0);
    // Never sent, so the new-submission path is available without any warning of a stored copy.
    expect(
      screen.getByRole("heading", { name: "Recordings can't be sent" }).parentElement?.textContent,
    ).not.toContain("twice");
  });
});

const closed = () => expect(screen.queryByRole("alertdialog")).toBeNull();
const focused = (element: HTMLElement | null) =>
  waitFor(() => expect(document.activeElement).toBe(element));

describe("Start a new submission asks first", () => {
  async function failedSubmission() {
    routes.submit = [failure(502)];
    view();
    await startQuick("Valuable text");
    await press("Submit what I've said so far");
    await screen.findByRole("alert");
  }
  it("does nothing destructive until confirmed and starts on the safe choice", async () => {
    await failedSubmission();
    await press("Start a new submission");
    const dialog = await screen.findByRole("alertdialog", { name: "Discard this submission?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(button("Keep this submission"));
    expect(textarea().value).toBe("Valuable text");
    expect(stored("account:alice")).not.toBeNull();
  });
  it("keeps the submission and returns focus to the button that opened the question", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Keep this submission");
    await waitFor(closed);
    await focused(button("Start a new submission"));
    expect(textarea().value).toBe("Valuable text");
  });
  it("closes with Escape and returns focus", async () => {
    await failedSubmission();
    await press("Start a new submission");
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(closed);
    await focused(button("Start a new submission"));
  });
  it("ignores other keys", async () => {
    await failedSubmission();
    await press("Start a new submission");
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "a" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
  it("offers a download first without discarding", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Download my feedback first");
    await waitFor(() => expect(download.saveFeedbackArchive).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(stored("account:alice")).not.toBeNull();
  });
  it("discards only when confirmed and puts focus in the new interview", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Discard and start a new submission");
    await waitFor(closed);
    expect(textarea().value).toBe("");
    expect(frozen()).toBe(false);
    expect(stored("account:alice")).toBeNull();
    await focused(textarea());
  });
});

describe("a session that is not live (N1)", () => {
  it.each([
    "expired",
    "signed-out",
    "loading-more",
  ])("treats status %s with an account still set as locked", async (status) => {
    seed("account:alice");
    view(alice, status);
    expect(screen.getByRole("status").textContent).toContain("Your session has ended");
    expect(screen.queryByRole("heading", { name: "Restore your unsent feedback?" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).not.toContain("Private story");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    expect(stored("account:alice")).not.toBeNull();
  });
  it("offers the draft again once the session is ready", async () => {
    seed("account:alice");
    const { rerender } = view(alice, "expired");
    rerender(
      <AccountsContext.Provider value={accounts(alice, "ready")}>
        <FeedbackPage />
      </AccountsContext.Provider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Restore your unsent feedback?" }),
    ).toBeTruthy();
  });
  it("locks an open form whose session expires, without submitting or downloading", async () => {
    const { rerender } = view();
    await startQuick("Secret words");
    rerender(
      <AccountsContext.Provider value={accounts(alice, "expired")}>
        <FeedbackPage />
      </AccountsContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: /Submit|Download/ })).toBeNull();
    expect(document.body.textContent).not.toContain("Secret words");
    expect(submits()).toHaveLength(0);
  });
});

describe("sign-out clears the draft wherever the person is (N2)", () => {
  const onlyCleanup = () => render(<FeedbackDraftCleanup />);
  it("removes the account's draft when /feedback is not mounted, keeping others", async () => {
    seed("account:alice");
    seed("account:bob");
    seed("signed-out");
    onlyCleanup();
    await beforeSignOut(alice);
    expect(stored("account:alice")).toBeNull();
    expect(stored("account:bob")).not.toBeNull();
    expect(stored("signed-out")).not.toBeNull();
  });
  it("removes every signed-in account's draft on sign-out of all accounts", async () => {
    const bob = { ...alice, id: "bob" };
    seed("account:alice");
    seed("account:bob");
    seed("account:carol");
    onlyCleanup();
    await Promise.all([beforeSignOut(alice), beforeSignOut(bob)]);
    expect(stored("account:alice")).toBeNull();
    expect(stored("account:bob")).toBeNull();
    expect(stored("account:carol")).not.toBeNull();
  });
  it("survives blocked storage", async () => {
    onlyCleanup();
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(beforeSignOut(alice)).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it("stops the handler on unmount", async () => {
    seed("account:alice");
    const { unmount } = onlyCleanup();
    unmount();
    expect(beforeSignOut(alice)).toBeUndefined();
    expect(stored("account:alice")).not.toBeNull();
  });
  it("does not let a submit still running re-save the draft after sign-out", async () => {
    let release: (reply: Response) => void = () => {};
    routes.audio = [okReceipt, () => new Promise<Response>((resolve) => (release = resolve))];
    routes.submit = [failure(502)];
    view();
    await startQuick();
    await attachClip();
    // Make the saved receipt too old, so Submit uploads again and waits there.
    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + 3 * 3_600_000);
    await act(async () => {
      fireEvent.click(button("Submit what I've said so far"));
    });
    await waitFor(() => expect(stored("account:alice")).not.toBeNull());
    await beforeSignOut(alice);
    expect(stored("account:alice")).toBeNull();
    await act(async () => release(okReceipt()));
    await waitFor(() => expect(submits()).toHaveLength(1));
    await screen.findByRole("alert");
    expect(stored("account:alice")).toBeNull();
  });
  it("allows drafts again for the same account in a new session", async () => {
    onlyCleanup();
    await beforeSignOut(alice);
    cleanup();
    routes.submit = [failure(502)];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    await screen.findByRole("alert");
    expect(stored("account:alice")).not.toBeNull();
  });
});

describe("prompts are labelled regions and manage focus (N4)", () => {
  it("shows the restore prompt as a labelled region, not an alert, and focuses its heading", async () => {
    seed("account:alice");
    view();
    const heading = await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    expect(screen.getByRole("region", { name: "Restore your unsent feedback?" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(heading);
  });
  it("moves focus to the conversation after Restore", async () => {
    seed("account:alice");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await focused(screen.getByRole("log"));
  });
  it("moves focus to the page heading after Discard", async () => {
    seed("account:alice");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Discard it"));
    await focused(screen.getByRole("heading", { name: "Give feedback" }));
  });
  it("shows lost recordings as a labelled region that receives focus, not an alert", async () => {
    seed("account:alice", [0], []);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    const heading = await screen.findByRole("heading", { name: "Recordings can't be sent" });
    expect(screen.getByRole("region", { name: "Recordings can't be sent" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // Submit is disabled at this point; focus must already be on the explanation.
    await focused(heading);
    expect((button("Submit") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("restored state and wording (N8)", () => {
  it("does not mark a draft saved before any request as possibly stored", async () => {
    routes.submit = [failure(400, "invalid")];
    seed("account:alice", undefined, [], Date.now(), false);
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByText("Private story");
    await press("Submit");
    expect((await screen.findByRole("alert")).textContent).toContain("email address");
    await waitFor(() => expect(screen.queryByLabelText("Your answer")).toBeNull());
    expect(stored("account:alice")).toBeNull();
  });
  it("keeps a draft saved after an uncertain attempt frozen and words the rejection accordingly", async () => {
    routes.submit = [failure(400, "invalid")];
    seed("account:alice");
    view();
    await screen.findByRole("heading", { name: "Restore your unsent feedback?" });
    fireEvent.click(button("Restore it"));
    await screen.findByText("Private story");
    await press("Submit");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("can't be changed here");
    expect(alert.textContent).not.toContain("email address");
    expect(stored("account:alice")).not.toBeNull();
  });
  it("persists that an attempt may have reached storage", async () => {
    routes.submit = [failure(502)];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    await screen.findByRole("alert");
    expect(JSON.parse(stored("account:alice") ?? "{}").uncertain).toBe(true);
  });
  it("persists a draft from a failure that never reached storage as not uncertain", async () => {
    routes.submit = [failure(429, "rate_limited", { "Retry-After": "60" })];
    view();
    await startQuick();
    await press("Submit what I've said so far");
    await screen.findByRole("alert");
    expect(JSON.parse(stored("account:alice") ?? "{}").uncertain).toBe(false);
  });
  it("does not send unsent textarea text twice after removing recordings", async () => {
    routes.audio = [okReceipt, failure(400, "invalid")];
    view();
    await startQuick("Typed once");
    await attachClip();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 3_600_000);
    await press("Submit what I've said so far");
    await screen.findByRole("heading", { name: "Recordings can't be sent" });
    await press("Remove recordings and record again");
    expect(textarea().value).toBe("");
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({
        path: new URL(String(input), "https://suite.test").pathname,
        method: init?.method ?? "GET",
        body: init?.body ? String(init.body) : undefined,
      });
      return Response.json({ reference: 9 });
    });
    await press("Submit what I've said so far");
    await waitFor(() => expect(submits()).toHaveLength(1));
    const transcript = sentBody().record.transcript as { content: string }[];
    expect(transcript.filter((m) => m.content === "Typed once")).toHaveLength(1);
  });
});
