// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { appRegistry } from "../src/shell/registry";
import {
  initialUi,
  parseProgress,
  readWalkthrough,
  WALKTHROUGH_KEY,
  WALKTHROUGH_UI_KEY,
  writeWalkthrough,
} from "../src/welcome/progress";
import { walkthroughSteps } from "../src/welcome/steps";

describe("walkthrough steps", () => {
  it("covers the requested areas in order with two or three tasks and real routes", () => {
    expect(walkthroughSteps.map((step) => step.id)).toEqual([
      "home",
      "drive",
      "docs",
      "tasks",
      "calendar",
      "contacts",
      "photos-music-money",
      "permissions",
      "feedback",
    ]);
    for (const step of walkthroughSteps) {
      expect(step.tasks.length).toBeGreaterThanOrEqual(2);
      expect(step.tasks.length).toBeLessThanOrEqual(3);
      expect(step.destinations.length).toBeGreaterThan(0);
      for (const destination of step.destinations) {
        if (destination.app)
          expect(appRegistry.find((app) => app.slug === destination.app)?.basePath).toBe(
            destination.href,
          );
        else expect(destination.href).toBe("/feedback");
      }
      const first = step.destinations[0];
      if (step.destinations.length === 1 && first?.app) expect(step.id).toBe(first.app);
    }
  });
});

describe("walkthrough persistence", () => {
  it("round trips the agreed feedback shape independently from guide visibility", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const ui = { started: true, dismissed: true, collapsed: false };
    writeWalkthrough(storage, { done: ["drive", "docs"] }, ui);
    expect(JSON.parse(values.get(WALKTHROUGH_KEY) ?? "null")).toEqual({ done: ["drive", "docs"] });
    expect(JSON.parse(values.get(WALKTHROUGH_UI_KEY) ?? "null")).toEqual(ui);
    expect(readWalkthrough(storage)).toEqual({ progress: { done: ["drive", "docs"] }, ui });
  });
  it("handles malformed, missing, repeated and unknown progress", () => {
    for (const raw of [null, "{", "null", "[]", '{"done":true}'])
      expect(parseProgress(raw)).toEqual({ done: [] });
    expect(
      parseProgress('{"done":["drive","drive",null,1,"unknown","docs"],"extra":true}'),
    ).toEqual({ done: ["drive", "docs"] });
  });
  it("survives blocked storage and treats malformed visibility as not started", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readWalkthrough(blocked)).toEqual({ progress: { done: [] }, ui: initialUi });
    expect(() => writeWalkthrough(blocked, { done: ["home"] }, initialUi)).not.toThrow();
    expect(readWalkthrough({ getItem: () => "{" }).ui).toEqual(initialUi);
    expect(readWalkthrough({ getItem: () => '{"started":"true","dismissed":1}' }).ui).toEqual(
      initialUi,
    );
  });
});
