// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { fakeConnections, samplePlan, sourceRoot, targetRoot } from "./fixtures.js";

vi.mock("../../src/engine/index.js", () => ({
  createPodHttp: vi.fn(({ root }) => ({ root })),
  planMigration: vi.fn(),
  finalizePlan: vi.fn((plan, resolutions) => ({ plan, resolutions })),
  executeMigration: vi.fn(),
}));

const result = {
  copied: [`${targetRoot}notes.txt`],
  skipped: [],
  failed: [],
  aclWritten: [`${targetRoot}.acr`],
  verified: true,
  cancelled: false,
  log: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(planMigration).mockResolvedValue(structuredClone(samplePlan));
  vi.mocked(executeMigration).mockResolvedValue(structuredClone(result));
  vi.mocked(finalizePlan).mockImplementation((plan, resolutions) => ({ plan, resolutions }));
});
afterEach(cleanup);

async function options() {
  const connections = fakeConnections();
  render(<App connections={connections} />);
  const source = screen.getByRole("button", { name: /Continue to target/ });
  await waitFor(() => expect(source).toBeEnabled());
  fireEvent.click(source);
  const target = screen.getByRole("button", { name: /Continue to options/ });
  await waitFor(() => expect(target).toBeEnabled());
  fireEvent.click(target);
  return connections;
}

async function review() {
  const connections = await options();
  fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
  await screen.findByRole("button", { name: "Start migration" });
  return connections;
}

function chooseAll() {
  for (const radio of screen.getAllByRole("radio", { name: /Leave out the group grant/ }))
    fireEvent.click(radio);
}

describe("review gating", () => {
  it("requires both connections before proceeding", async () => {
    const connections = fakeConnections();
    vi.spyOn(connections[0], "initialize").mockResolvedValue();
    vi.spyOn(connections[1], "initialize").mockResolvedValue();
    render(<App connections={connections} />);
    expect(screen.getByRole("button", { name: /Continue to target/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Swap source and target/ })).toBeDisabled();
    expect(planMigration).not.toHaveBeenCalled();
  });

  it("preselects only info recommendations and keeps Start disabled until every decision is resolved", async () => {
    await review();
    expect(screen.getByRole("radio", { name: /Keep this access/ })).toBeChecked();
    const choices = screen.getAllByRole("radio", { name: /Leave out the group grant/ });
    for (const radio of choices) expect(radio).not.toBeChecked();
    const start = screen.getByRole("button", { name: "Start migration" });
    expect(start).toBeDisabled();
    if (choices[0]) fireEvent.click(choices[0]);
    expect(start).toBeDisabled();
    if (choices[1]) fireEvent.click(choices[1]);
    expect(start).toBeEnabled();
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("shows the abort state and never finalizes or writes", async () => {
    await review();
    chooseAll();
    const abort = screen.getAllByRole("radio", { name: /Stop the migration/ })[0];
    if (abort) fireEvent.click(abort);
    expect(screen.getByText("Migration will not run.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start migration" })).toBeDisabled();
    expect(finalizePlan).not.toHaveBeenCalled();
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("applies a choice only to matching kinds with that option", async () => {
    await review();
    const first = screen.getAllByRole("radio", { name: /Leave out the group grant/ })[0];
    if (first) fireEvent.click(first);
    const bulk = screen.getAllByRole("button", { name: "Apply to all of this kind" })[0];
    if (bulk) fireEvent.click(bulk);
    expect(
      screen
        .getAllByRole("radio", { name: /Leave out the group grant/ })
        .every((radio) => (radio as HTMLInputElement).checked),
    ).toBe(true);
    expect(screen.getByRole("radio", { name: /Keep this access/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Start migration" })).toBeEnabled();
    fireEvent.click(screen.getByText("Group access for friends"));
    expect(
      screen.getAllByText(/The destination cannot follow this group/, { selector: "p" })[0],
    ).toBeVisible();
    expect(screen.getAllByText(/View original permission rule/)).toHaveLength(2);
  });

  it("swaps credentials and roots together, persists direction, and resets destination options", async () => {
    const connections = await options();
    fireEvent.click(screen.getByRole("button", { name: /Swap source and target/ }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Target folder URL" })).toHaveValue(sourceRoot),
    );
    expect(
      within(screen.getByRole("region", { name: "source connection" })).getByText(targetRoot),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "target connection" })).getByText(sourceRoot),
    ).toBeVisible();
    expect(sessionStorage.getItem("pod-migrator:swapped:v1")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
    await screen.findByRole("button", { name: "Start migration" });
    expect(planMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          root: targetRoot,
          ownerWebId: connections[1].auth.webId,
        }),
        target: expect.objectContaining({
          root: sourceRoot,
          ownerWebId: connections[0].auth.webId,
        }),
        targetContainer: sourceRoot,
        rewriteIris: false,
      }),
    );
  });

  it("does not bulk-select an option missing from another item of the same kind", async () => {
    const plan = structuredClone(samplePlan);
    const sibling = plan.report.find((item) => item.id === "colleagues");
    if (!sibling) throw new Error("Missing fixture");
    sibling.options = sibling.options.filter((option) => option.id !== "skip");
    vi.mocked(planMigration).mockResolvedValue(plan);
    await review();
    fireEvent.click(screen.getByRole("radio", { name: /Leave out the group grant/ }));
    const bulk = screen.getAllByRole("button", { name: "Apply to all of this kind" })[0];
    if (!bulk) throw new Error("Missing bulk control");
    fireEvent.click(bulk);
    expect(screen.getByRole("button", { name: "Start migration" })).toBeDisabled();
    expect(screen.getByText("1 permission decision still needs your choice.")).toBeVisible();
  });

  it("invalidates reviewed choices when options change", async () => {
    await review();
    chooseAll();
    fireEvent.click(screen.getByRole("button", { name: "Back to options" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
    await screen.findByRole("button", { name: "Start migration" });
    expect(screen.getByRole("button", { name: "Start migration" })).toBeDisabled();
    expect(planMigration).toHaveBeenLastCalledWith(expect.objectContaining({ rewriteIris: true }));
  });

  it.each([
    "https://storage.example/bob-evil/",
    "https://storage.example/alice/",
    "https://evil.example/",
    "https://storage.example/bob/%2fprivate/",
    "https://storage.example/bob/no-slash",
    "https://storage.example/bob/?query=1",
  ])("refuses destination %s before planning", async (url) => {
    await options();
    fireEvent.change(screen.getByRole("textbox", { name: "Target folder URL" }), {
      target: { value: url },
    });
    expect(screen.getByRole("button", { name: /Create migration plan/ })).toBeDisabled();
    expect(planMigration).not.toHaveBeenCalled();
  });
});

describe("running and results", () => {
  it("finalizes before execution and displays actual counts and verification", async () => {
    await review();
    chooseAll();
    fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
    await screen.findByRole("heading", { name: "Migration finished" });
    expect(finalizePlan).toHaveBeenCalledExactlyOnceWith(samplePlan, {
      owner: "acknowledge",
      friends: "skip",
      colleagues: "skip",
    });
    expect(executeMigration).toHaveBeenCalledOnce();
    expect(screen.getByText("Verification passed")).toBeVisible();
    const saved = JSON.parse(sessionStorage.getItem("pod-migrator:run-report:v1") ?? "null");
    expect(saved).toMatchObject({
      status: "finished",
      result: { verified: true, copied: [`${targetRoot}notes.txt`] },
    });
  });

  it("does not execute when the engine refuses finalization", async () => {
    await review();
    chooseAll();
    vi.mocked(finalizePlan).mockImplementation(() => {
      throw new Error("Unsafe plan");
    });
    fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This plan cannot run safely");
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("cancels in-flight execution, records progress, and waits for the engine result", async () => {
    let finish: (value: typeof result) => void = () => {};
    vi.mocked(executeMigration).mockImplementation((_plan, opts) => {
      opts.onProgress?.({ phase: "copy", done: 1, total: 2, current: `${targetRoot}notes.txt` });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await review();
    chooseAll();
    fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
    await screen.findByRole("button", { name: "Cancel migration" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(sessionStorage.getItem("pod-migrator:run-report:v1")).toContain("Copying your files");
    fireEvent.click(screen.getByRole("button", { name: "Cancel migration" }));
    expect(vi.mocked(executeMigration).mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(screen.getByText("Stopping after the current request…")).toBeVisible();
    await act(async () => finish({ ...result, verified: false, cancelled: true }));
    expect(screen.getByRole("heading", { name: "Migration cancelled" })).toBeVisible();
    expect(screen.getByText("Verification has not passed")).toBeVisible();
  });

  it("discards a plan returned after cancellation", async () => {
    let finish: (value: typeof samplePlan) => void = () => {};
    vi.mocked(planMigration).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await options();
    fireEvent.click(screen.getByRole("button", { name: /Create migration plan/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel planning" }));
    await act(async () => finish(samplePlan));
    expect(screen.queryByRole("button", { name: "Start migration" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create migration plan/ })).toBeVisible();
  });

  it("reports unexpected partial execution as interrupted and never verified", async () => {
    vi.mocked(executeMigration).mockRejectedValue(new Error("network disconnected"));
    await review();
    chooseAll();
    fireEvent.click(screen.getByRole("button", { name: "Start migration" }));
    await screen.findByRole("heading", { name: "Migration interrupted" });
    expect(screen.queryByText("Verification passed")).not.toBeInTheDocument();
    expect(screen.getByText(/The last request may have completed/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Download report JSON" })).toBeVisible();
  });

  it("restores an interrupted log after reload without resuming writes", async () => {
    sessionStorage.setItem(
      "pod-migrator:run-report:v1",
      JSON.stringify({
        version: 1,
        status: "running",
        source: { root: sourceRoot },
        target: { root: targetRoot },
        result: null,
        log: [{ at: "2026-10-27T00:00:00Z", message: "Copying your files" }],
      }),
    );
    render(<App connections={fakeConnections()} />);
    fireEvent.click(screen.getByText(/Report from your previous run/));
    expect(screen.getByRole("heading", { name: "Migration interrupted" })).toBeVisible();
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("ignores malformed saved reports without breaking the sign-in screen", () => {
    sessionStorage.setItem(
      "pod-migrator:run-report:v1",
      JSON.stringify({
        version: 1,
        status: "finished",
        source: { root: sourceRoot },
        target: { root: targetRoot },
        result: { verified: true },
        log: [],
      }),
    );
    render(<App connections={fakeConnections()} />);
    expect(screen.queryByText(/Report from your previous run/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to target/ })).toBeVisible();
  });
});
