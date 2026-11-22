// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ state: "online" }));
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
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => connection.state }));

import { AskWorkspace } from "../../src/apps/ask/components/ask-app";
import { AskModelError } from "../../src/apps/ask/lib/model";
import type { AskPassage } from "../../src/apps/ask/lib/retrieval";
import { AskContext } from "../../src/apps/ask/state/ask-context";
import { AskController } from "../../src/apps/ask/state/controller";

const passage: AskPassage = {
  url: "https://pod.example/passport#it",
  title: "Passport",
  text: "My passport expires in 2028.",
  app: "notes",
  type: "document",
  modified: "2026-11-10T10:00:00Z",
  href: "/notes/n/passport",
};
function fixture(
  passages = [passage],
  // null means no model; undefined would select this default.
  answer: (() => Promise<string>) | null = async () =>
    "In 2028 [1]. Invented claim [99]. <script>alert(1)</script>.",
  demo = false,
  inboxUnidentified = false,
) {
  return new AskController(
    {
      count: passages.length,
      scopes: ["notes", "docs"],
      limited: false,
      inboxUnidentified,
      retrieve: () => passages,
      dispose: () => {},
    },
    answer ? { answer } : undefined,
    demo,
  );
}
function render(controller: AskController) {
  return renderToStaticMarkup(
    <AskContext value={controller}>
      <AskWorkspace />
    </AskContext>,
  );
}
it("renders question controls, truthful coverage and an empty session", () => {
  const html = render(fixture());
  expect(html).toContain("Your question");
  expect(html).toContain("What would you like to find?");
  expect(html).toContain("Answer from my pod only (no AI)");
  expect(html).toContain("Only in this session");
  expect(html).toContain("readable labels and description snippets");
});
it("says when the profile inbox couldn't be identified, and only then", async () => {
  const notice = "Couldn&#x27;t identify your inbox; items in it may appear as sources.";
  expect(render(fixture())).not.toContain(notice);
  const unidentified = fixture([passage], null, false, true);
  expect(render(unidentified)).toContain(notice);
  await unidentified.ask("passport", undefined, true, true);
  const html = render(unidentified);
  expect(html).toContain("Your profile&#x27;s inbox couldn&#x27;t be identified");
  expect(html).not.toContain("Inbox items are left out");
  const identified = fixture([passage], null);
  await identified.ask("passport", undefined, true, true);
  expect(render(identified)).toContain("Inbox items are left out, because anyone can send them.");
});
it("renders inline citation links and visibly flags unsupported sentences, escaping hostile output", async () => {
  const controller = fixture();
  await controller.ask("passport", undefined, false, true);
  await controller.consent();
  const html = render(controller);
  expect(html).toContain('aria-label="Source 1: Passport"');
  expect(html).toContain('href="/notes/n/passport"');
  expect(html).toContain("No valid source citation");
  expect(html).toContain("Unknown citation removed");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Which data was used");
  expect(html).toContain("10 Nov 2026");
  expect(html).toContain('href="https://pod.example/passport#it"');
  expect(html).toContain('rel="noopener noreferrer"');
});
it("renders offline extracts, demo, empty retrieval and model failure recovery", async () => {
  connection.state = "offline";
  try {
    const local = fixture([passage], async () => "unused", true);
    await local.ask("passport", undefined, false, false);
    const html = render(local);
    expect(html).toContain("You&#x27;re offline");
    expect(html).toContain("Fictional sample pod");
    expect(html).toContain("Matching extracts");
    const empty = fixture([]);
    await empty.ask("unicorn", undefined, true, false);
    expect(render(empty)).toContain("Nothing in your pod matches");
    const failed = fixture([passage], async () => {
      throw new AskModelError("not-configured");
    });
    await failed.ask("passport", undefined, false, true);
    await failed.consent();
    expect(render(failed)).toContain("Use an answer without AI");
    expect(render(failed)).toContain("configured on this server");
  } finally {
    connection.state = "online";
  }
});

describe("without a model (the shipped configuration)", () => {
  it("shows one neutral extract-only line and no AI controls or wording", async () => {
    connection.state = "offline";
    try {
      const controller = fixture([passage], null, true);
      const idle = render(controller);
      expect(idle).toContain("Answers are extracts from your pod. Nothing leaves your browser.");
      await controller.ask("passport", undefined, false, false);
      const html = render(controller);
      for (const absent of [
        'role="switch"',
        "no AI",
        "without AI",
        "Anthropic",
        "AI provider",
        "Written by AI",
        "Writing an answer",
        "AI call",
      ])
        expect(html).not.toContain(absent);
      expect(html).toContain("Fictional sample pod.");
      expect(html).toContain("in this session.");
      expect(html).toContain("Matching extracts");
      expect(html).toContain("Nothing left your browser.");
    } finally {
      connection.state = "online";
    }
  });
  it("renders a neutral not-found state instead of a citation warning", async () => {
    const controller = fixture([{ ...passage, text: "Nothing relevant here." }], null);
    await controller.ask("passport", undefined, false, true);
    const html = render(controller);
    expect(html).toContain("I couldn&#x27;t find that in your pod");
    expect(html).not.toContain("No valid source citation");
    expect(html).not.toContain('aria-label="Answer"');
    expect(html).toContain('id="ask-sources-title"');
  });
  it("names apps from the suite registry rather than raw slugs", async () => {
    const controller = fixture([passage], null);
    await controller.ask("passport", undefined, false, true);
    const html = render(controller);
    expect(html).toContain("<span>Notes</span>");
    expect(html).toContain("<span>Docs</span>");
    expect(html).not.toMatch(/>notes</);
    expect(html).not.toMatch(/>docs</);
  });
});
it("keeps a model's refusal neutral too", async () => {
  const controller = fixture([passage], async () => "I couldn't find that in your pod.");
  await controller.ask("passport", undefined, false, true);
  await controller.consent();
  const html = render(controller);
  expect(html).toContain("I couldn&#x27;t find that in your pod");
  expect(html).not.toContain("No valid source citation");
});
