// AUTHORED-BY Codex (GPT-6.1 Sol)
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AskContext, useAsk } from "../../src/apps/ask/state/ask-context";
import { AskController } from "../../src/apps/ask/state/controller";

function Consumer() {
  const { state } = useAsk();
  return <span>{state.status}</span>;
}
it("exposes the session's question snapshot and fails clearly outside its provider", () => {
  expect(() => renderToStaticMarkup(<Consumer />)).toThrow("active pod session");
  const controller = new AskController(
    { count: 0, scopes: [], limited: false, retrieve: () => [], dispose: () => {} },
    { answer: async () => "unused" },
    true,
  );
  expect(
    renderToStaticMarkup(
      <AskContext value={controller}>
        <Consumer />
      </AskContext>,
    ),
  ).toContain("idle");
});
