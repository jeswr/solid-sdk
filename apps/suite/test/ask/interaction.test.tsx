// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";

vi.mock("@/shell/app-frame", () => ({
  AppFrame: ({ children, sidebar }: { children: ReactNode; sidebar: ReactNode }) => (
    <div>
      {sidebar}
      {children}
    </div>
  ),
  AppHeading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "loading" }),
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));

import { AskWorkspace } from "../../src/apps/ask/components/ask-app";
import type { AskPassage, AskRetrieval } from "../../src/apps/ask/lib/retrieval";
import { AskContext } from "../../src/apps/ask/state/ask-context";
import { AskController } from "../../src/apps/ask/state/controller";

const passport: AskPassage = {
  url: "https://pod.example/passport#it",
  title: "Passport",
  text: "My passport expires in 2028.",
  app: "notes",
  href: "/notes/n/passport",
};
const garden: AskPassage = {
  url: "https://pod.example/garden#it",
  title: "Garden",
  text: "Rowan plants lavender in the garden.",
  app: "docs",
  href: "/docs/d/garden",
};
function retrieval(): AskRetrieval {
  return {
    count: 2,
    scopes: ["docs", "notes"],
    limited: false,
    inboxUnidentified: false,
    retrieve: vi.fn((question: string, scope?: string) =>
      [passport, garden].filter(
        (source) =>
          (!scope || source.app === scope) &&
          question
            .toLowerCase()
            .split(/\W+/)
            .some((word) => word && source.text.toLowerCase().includes(word)),
      ),
    ),
    dispose: vi.fn(),
  };
}
function mount(controller: AskController) {
  render(
    <AskContext value={controller}>
      <AskWorkspace />
    </AskContext>,
  );
}
const question = () => screen.getByRole("textbox", { name: "Your question" });
async function askFor(text: string) {
  fireEvent.change(question(), { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(question(), { key: "Enter" });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The consent dialog measures its content.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("re-runs the shown question when the app filter changes", async () => {
  const sources = retrieval();
  mount(new AskController(sources, undefined, false));
  await askFor("passport");
  expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("2028");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
  });
  expect(sources.retrieve).toHaveBeenLastCalledWith("passport", "docs");
  expect(screen.getByRole("heading", { name: /Nothing in your pod matches/ })).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "All apps" }));
  });
  expect(sources.retrieve).toHaveBeenLastCalledWith("passport", undefined);
  expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("2028");
});

it("only filters an edited, unsubmitted question, then applies the filter when it is asked", async () => {
  const sources = retrieval();
  mount(new AskController(sources, undefined, false));
  await askFor("passport");
  fireEvent.change(question(), { target: { value: "garden" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
  });
  expect(sources.retrieve).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Docs" }).getAttribute("aria-pressed")).toBe("true");
  expect((question() as HTMLTextAreaElement).value).toBe("garden");
  expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("2028");
  await act(async () => {
    fireEvent.keyDown(question(), { key: "Enter" });
  });
  expect(sources.retrieve).toHaveBeenLastCalledWith("garden", "docs");
  // Whitespace around the shown question still counts as the shown question.
  fireEvent.change(question(), { target: { value: " garden " } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "All apps" }));
  });
  expect(sources.retrieve).toHaveBeenLastCalledWith("garden", undefined);
  expect(sources.retrieve).toHaveBeenCalledTimes(3);
});

it("only filters, without asking, before any question", async () => {
  const sources = retrieval();
  mount(new AskController(sources, undefined, false));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
  });
  expect(sources.retrieve).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
});

it("re-asks a recent question when it is clicked", async () => {
  const sources = retrieval();
  mount(new AskController(sources, undefined, false));
  await askFor("passport");
  await askFor("garden");
  expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("lavender");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "passport" }));
  });
  expect(sources.retrieve).toHaveBeenLastCalledWith("passport", undefined);
  expect((question() as HTMLTextAreaElement).value).toBe("passport");
  expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("2028");
});

it("renders repeated sentences without duplicate React keys", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const controller = new AskController(
    retrieval(),
    { answer: async () => "It expires in 2028 [1]. It expires in 2028 [1]." },
    false,
  );
  mount(controller);
  await act(async () => {
    fireEvent.click(screen.getByRole("switch", { name: "Answer from my pod only (no AI)" }));
  });
  await askFor("passport");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Allow for this session" }));
  });
  const answer = screen.getByRole("region", { name: "Answer" });
  expect(answer.querySelectorAll(".ask-answer-text p")).toHaveLength(2);
  expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
});
