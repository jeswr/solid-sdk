// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

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
  answer = async () => "In 2028 [1]. Invented claim [99]. <script>alert(1)</script>.",
  demo = false,
) {
  return new AskController(
    {
      count: passages.length,
      scopes: ["notes", "docs"],
      limited: false,
      retrieve: () => passages,
      dispose: () => {},
    },
    { answer },
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
