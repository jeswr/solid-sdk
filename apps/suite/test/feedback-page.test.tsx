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
import { legacyDraftKey, saveDraft } from "../src/feedback/draft";
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
const seed = (owner: string, audio?: number[], receipts: unknown[] = [], at = Date.now()) =>
  saveDraft(
    window.localStorage,
    owner,
    { submissionId, record: record(audio), receipts: receipts as never },
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
    saveDraft(window.localStorage, "account:alice", { submissionId, record: "{}", receipts: [] });
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
    ["storage not switched on", failure(503, "unavailable"), "isn't switched on", false],
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

describe("Start a new submission asks first", () => {
  async function failedSubmission() {
    routes.submit = [failure(502)];
    view();
    await startQuick("Valuable text");
    await press("Submit what I've said so far");
    await screen.findByRole("alert");
  }
  it("does nothing destructive until confirmed, announces itself and moves focus", async () => {
    await failedSubmission();
    await press("Start a new submission");
    const heading = screen.getByRole("heading", { name: "Discard this submission?" });
    expect(heading.closest('[role="alert"]')).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(textarea().value).toBe("Valuable text");
    expect(stored("account:alice")).not.toBeNull();
  });
  it("keeps the submission and returns focus to the button that opened the question", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Keep this submission");
    expect(screen.queryByRole("heading", { name: "Discard this submission?" })).toBeNull();
    expect(document.activeElement).toBe(button("Start a new submission"));
    expect(textarea().value).toBe("Valuable text");
  });
  it("closes with Escape and returns focus", async () => {
    await failedSubmission();
    await press("Start a new submission");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Discard this submission?" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("heading", { name: "Discard this submission?" })).toBeNull();
    expect(document.activeElement).toBe(button("Start a new submission"));
  });
  it("ignores other keys", async () => {
    await failedSubmission();
    await press("Start a new submission");
    fireEvent.keyDown(screen.getByRole("heading", { name: "Discard this submission?" }), {
      key: "a",
    });
    expect(screen.getByRole("heading", { name: "Discard this submission?" })).toBeTruthy();
  });
  it("offers a download first without discarding", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Download my feedback first");
    await waitFor(() => expect(download.saveFeedbackArchive).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Discard this submission?" })).toBeTruthy();
    expect(textarea().value).toBe("Valuable text");
  });
  it("discards only when confirmed", async () => {
    await failedSubmission();
    await press("Start a new submission");
    await press("Discard and start a new submission");
    expect(screen.queryByRole("heading", { name: "Discard this submission?" })).toBeNull();
    expect(textarea().value).toBe("");
    expect(frozen()).toBe(false);
    expect(stored("account:alice")).toBeNull();
  });
});
