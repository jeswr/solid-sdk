// AUTHORED-BY Codex (GPT-6.1 Sol)
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
function setup(demo = false) {
  const retrieval: AskRetrieval = {
    scopes: ["notes"],
    count: 1,
    limited: false,
    retrieve: vi.fn(() => [passage]),
    dispose: vi.fn(),
  };
  const model = { answer: vi.fn(async () => "It expires in September 2028 [1].") };
  return { retrieval, model, controller: new AskController(retrieval, model, demo) };
}
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
          new Promise((resolve, fail) => {
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
