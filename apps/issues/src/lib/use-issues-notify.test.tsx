// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useIssues } from "./use-issues";

const { announcerOptions } = vi.hoisted(() => ({ announcerOptions: vi.fn() }));
vi.mock("./announce", () => ({
  Announcer: class {
    constructor(options: unknown) {
      announcerOptions(options);
    }
  },
}));
vi.mock("./repository", () => ({
  Repository: class {
    async list() {
      return { issues: [], canCreate: true };
    }
    async listSprints() {
      return [];
    }
  },
}));
vi.mock("./notifications", () => ({ watchContainer: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("./issue-cache", () => ({ readIssueCache: () => undefined, writeIssueCache: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test.each([
  "production",
  "development",
])("notification loopback opt-in requires a development build (%s)", async (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  renderHook(() =>
    useIssues("https://pod.example/tracker", "https://pod.example/#me", ["https://pod.example/"]),
  );
  await act(async () => {});
  expect(announcerOptions).toHaveBeenCalledWith(
    expect.objectContaining({ devLoopback: mode !== "production" }),
  );
});
