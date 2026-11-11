// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5

import type { GroundedPrompt } from "@jeswr/pod-ask";
import { describe, expect, it, vi } from "vitest";
import { AskModelError } from "../../src/apps/ask/lib/model";
import type { AskPassage, AskRetrieval } from "../../src/apps/ask/lib/retrieval";
import { AskController } from "../../src/apps/ask/state/controller";

const passage: AskPassage = {
  url: "https://pod.example/passport#it",
  title: "Passport",
  app: "notes",
  text: "My passport expires in September 2028.",
  href: "/notes/n/passport",
};
function retrieval(): AskRetrieval {
  return {
    scopes: ["notes"],
    count: 1,
    limited: false,
    retrieve: vi.fn((): AskPassage[] => [passage]),
    dispose: vi.fn(),
  };
}
/** A fake model keeps the AnswerModel seam covered; the app configures none today. */
function setup(demo = false) {
  const sources = retrieval();
  const model = {
    answer: vi.fn(
      async (_prompt: GroundedPrompt, _signal: AbortSignal) => "It expires in September 2028 [1].",
    ),
  };
  return { retrieval: sources, model, controller: new AskController(sources, model, demo) };
}
describe("without a model (the shipped configuration)", () => {
  it("always answers with extracts and never enters consent or answering", async () => {
    const sources = retrieval();
    const controller = new AskController(sources, undefined, false);
    const statuses: string[] = [];
    controller.subscribe(() => statuses.push(controller.getSnapshot().status));
    for (const noAi of [false, true]) {
      await controller.ask("passport", undefined, noAi, true);
      expect(controller.getSnapshot()).toMatchObject({ status: "answered", method: "extractive" });
    }
    await controller.consent();
    expect(statuses).not.toContain("consent");
    expect(statuses).not.toContain("answering");
    expect(controller.getSnapshot().answer?.citations[0]?.url).toBe(passage.url);
  });
  it("flags unmatched passages as not found rather than as an unsupported sentence", async () => {
    const sources = retrieval();
    vi.mocked(sources.retrieve).mockReturnValue([{ ...passage, text: "Nothing relevant here." }]);
    const controller = new AskController(sources, undefined, false);
    await controller.ask("passport", undefined, false, true);
    expect(controller.getSnapshot().answer).toMatchObject({ notFound: true, sentences: [] });
  });
});
describe("re-asking", () => {
  it("re-runs the current question with a new scope once something has been asked", async () => {
    const sources = retrieval();
    const controller = new AskController(sources, undefined, false);
    await controller.reask("notes", false, true);
    expect(sources.retrieve).not.toHaveBeenCalled();
    await controller.ask("passport", undefined, false, true);
    await controller.reask("notes", false, true);
    expect(sources.retrieve).toHaveBeenLastCalledWith("passport", "notes");
    vi.mocked(sources.retrieve).mockReturnValue([]);
    await controller.reask("docs", false, true);
    expect(controller.getSnapshot().status).toBe("empty");
    vi.mocked(sources.retrieve).mockReturnValue([passage]);
    await controller.reask(undefined, false, true);
    expect(sources.retrieve).toHaveBeenLastCalledWith("passport", undefined);
    expect(controller.getSnapshot().status).toBe("answered");
    expect(controller.getSnapshot().recent).toEqual(["passport"]);
  });
  it("does not re-ask behind the consent dialog", async () => {
    const { controller, retrieval: sources } = setup();
    await controller.ask("passport", undefined, false, true);
    expect(controller.getSnapshot().status).toBe("consent");
    await controller.reask("notes", false, true);
    expect(sources.retrieve).toHaveBeenCalledOnce();
  });
});
describe("with an injected model", () => {
  it("sends the built prompt and maps citations against the sources the prompt kept", async () => {
    const { controller, model, retrieval: sources } = setup();
    const kept = { ...passage, url: "https://pod.example/kept#it", title: "Kept" };
    vi.mocked(sources.retrieve).mockReturnValue([
      { ...passage, url: "https://pod.example/has space#it", title: "Dropped" },
      kept,
    ]);
    await controller.ask("passport", undefined, false, true);
    // Only the source that will be sent is listed and numbered.
    expect(controller.getSnapshot().passages).toEqual([kept]);
    await controller.consent();
    const [prompt] = model.answer.mock.calls[0] as [GroundedPrompt, AbortSignal];
    expect(prompt.passages.map((p) => p.url)).toEqual([kept.url]);
    expect(prompt.user).toContain("passport");
    expect(controller.getSnapshot().answer?.citations).toEqual([
      { number: 1, url: kept.url, title: "Kept" },
    ]);
  });
  it("falls back to extracts when the prompt can keep no source", async () => {
    const { controller, model, retrieval: sources } = setup();
    vi.mocked(sources.retrieve).mockReturnValue([{ ...passage, url: "javascript:alert(1)" }]);
    await controller.ask("passport", undefined, false, true);
    expect(controller.getSnapshot()).toMatchObject({ status: "answered", method: "extractive" });
    await controller.consent();
    expect(model.answer).not.toHaveBeenCalled();
  });
  it("treats a model's refusal as not found", async () => {
    const { controller, model } = setup();
    model.answer.mockResolvedValue("I couldn't find that in your pod.");
    await controller.ask("passport", undefined, false, true);
    await controller.consent();
    expect(controller.getSnapshot().answer).toMatchObject({ notFound: true, sentences: [] });
  });
});
describe("single-question state and consent", () => {
  it("uses local extracts in no-AI, demo and offline modes, without calling the model", async () => {
    for (const [demo, noAi, online] of [
      [false, true, true],
      [true, false, true],
      [false, false, false],
    ]) {
      const { controller, model } = setup(demo);
      await controller.ask("passport", undefined, noAi as boolean, online as boolean);
      expect(controller.getSnapshot().status).toBe("answered");
      expect(controller.getSnapshot().method).toBe("extractive");
      expect(controller.getSnapshot().answer?.citations[0]?.url).toBe(passage.url);
      expect(model.answer).not.toHaveBeenCalled();
    }
  });
  it("requires consent before the first call and retains it only in this controller", async () => {
    const { controller, model, retrieval } = setup();
    const listener = vi.fn();
    const off = controller.subscribe(listener);
    await controller.ask("passport", "notes", false, true);
    expect(retrieval.retrieve).toHaveBeenCalledWith("passport", "notes");
    expect(controller.getSnapshot().status).toBe("consent");
    expect(model.answer).not.toHaveBeenCalled();
    await controller.consent();
    expect(controller.getSnapshot().status).toBe("answered");
    expect(controller.getSnapshot().answer?.sentences[0]?.unsupported).toBe(false);
    await controller.ask("passport expiry", undefined, false, true);
    expect(model.answer).toHaveBeenCalledTimes(2);
    await controller.consent();
    expect(model.answer).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalled();
    off();
    const count = listener.mock.calls.length;
    await controller.ask("passport", undefined, true, true);
    expect(listener).toHaveBeenCalledTimes(count);
    expect(controller.getSnapshot().recent).toEqual(["passport", "passport expiry"]);
    const other = setup();
    await other.controller.ask("passport", undefined, false, true);
    expect(other.controller.getSnapshot().status).toBe("consent");
  });
  it("lets refusal use extracts, still asking for consent next time", async () => {
    const { controller, model } = setup();
    await controller.ask("passport", undefined, false, true);
    controller.showExtracts();
    expect(controller.getSnapshot().method).toBe("extractive");
    await controller.ask("passport", undefined, false, true);
    expect(controller.getSnapshot().status).toBe("consent");
    expect(model.answer).not.toHaveBeenCalled();
  });
  it("handles no matches, invalid questions and bounded recent questions", async () => {
    const { controller, retrieval } = setup();
    controller.showExtracts();
    await controller.consent();
    await controller.ask(" ", undefined, false, true);
    await controller.ask("x".repeat(2001), undefined, false, true);
    expect(retrieval.retrieve).not.toHaveBeenCalled();
    vi.mocked(retrieval.retrieve).mockReturnValue([]);
    for (let i = 0; i < 12; i++) await controller.ask(`question ${i}`, undefined, true, true);
    expect(controller.getSnapshot().status).toBe("empty");
    expect(controller.getSnapshot().recent).toHaveLength(8);
    expect(controller.getSnapshot().answer).toBeNull();
  });
  it.each([
    new AskModelError("not-configured"),
    new AskModelError("rate-limited"),
    new Error("private data"),
  ])("shows sanitised errors and supports a local recovery: %s", async (error) => {
    const { controller, model } = setup();
    model.answer.mockRejectedValue(error);
    await controller.ask("passport", undefined, false, true);
    await controller.consent();
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().error).toBe(
      error instanceof AskModelError ? error.code : "network",
    );
    controller.showExtracts();
    expect(controller.getSnapshot().status).toBe("answered");
  });
  it("fences delayed success and failure after supersession or session disposal", async () => {
    for (const fails of [true, false]) {
      const { controller, model, retrieval } = setup();
      let settle: (text: string) => void = () => {};
      let reject: (error: Error) => void = () => {};
      model.answer.mockImplementation(
        () =>
          new Promise<string>((resolve, fail) => {
            settle = resolve;
            reject = fail;
          }),
      );
      await controller.ask("passport", undefined, false, true);
      const old = controller.consent();
      expect(controller.getSnapshot().status).toBe("answering");
      await controller.ask("passport again", undefined, true, true);
      if (fails) reject(new Error("private"));
      else settle("Late claim [1].");
      await old;
      expect(controller.getSnapshot().question).toBe("passport again");
      const pending = controller.ask("another passport", undefined, false, true);
      controller.dispose();
      if (fails) reject(new Error("late"));
      else settle("Later [1].");
      await pending;
      const snapshot = controller.getSnapshot();
      await controller.ask("passport", undefined, false, true);
      await controller.consent();
      controller.showExtracts();
      expect(controller.getSnapshot()).toBe(snapshot);
      expect(retrieval.dispose).toHaveBeenCalledOnce();
    }
  });
});
