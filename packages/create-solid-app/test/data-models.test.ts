// AUTHORED-BY Claude Opus 4.8
/**
 * The "pick a data model → bound component" catalog (src/data-models.ts) is the
 * single source of truth shared by the CLI flag and the scaffold substitution.
 * These tests pin the catalog's shape so the flag, the help text, and the emitted
 * JSX can't drift: every entry has the four fields, keys are unique, the default
 * is present, and the tags are the real @jeswr/solid-components elements.
 */
import { describe, expect, it } from "vitest";
import {
  DATA_MODELS,
  DEFAULT_DATA_MODEL,
  dataModelKeys,
  findDataModel,
} from "../src/data-models.ts";

describe("data-models catalog", () => {
  it("every entry has key / tag / label / description / srcExpr", () => {
    for (const m of DATA_MODELS) {
      expect(m.key, "key").toBeTruthy();
      expect(m.tag, `tag for ${m.key}`).toBeTruthy();
      expect(m.label, `label for ${m.key}`).toBeTruthy();
      expect(m.description, `description for ${m.key}`).toBeTruthy();
      // srcExpr is a fixed token spliced into `src={…}` — only the two known locals.
      expect(["storage", "webId"], `srcExpr for ${m.key}`).toContain(m.srcExpr);
    }
  });

  it("the profile model binds the WebID (src={webId}); every other binds storage", () => {
    // <jeswr-profile-card> reads a WebID profile doc; the rest read a pod container.
    for (const m of DATA_MODELS) {
      expect(m.srcExpr, `${m.key} src`).toBe(m.key === "profile" ? "webId" : "storage");
    }
  });

  it("keys are unique", () => {
    const keys = dataModelKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the default model is in the catalog", () => {
    expect(findDataModel(DEFAULT_DATA_MODEL)).toBeDefined();
  });

  it("binds the real @jeswr/solid-components element tags", () => {
    // The bound tags are exactly the Phase-1 read elements (+ the composer). If a
    // tag here is wrong, the scaffold would emit a non-existent custom element.
    const tags = DATA_MODELS.map((m) => m.tag).sort();
    expect(tags).toEqual(
      [
        "jeswr-bookmark-list",
        "jeswr-collection",
        "jeswr-contact-list",
        "jeswr-profile-card",
        "jeswr-task-list",
        "solid-view",
      ].sort(),
    );
  });

  it("findDataModel returns undefined for an unknown key", () => {
    expect(findDataModel("nope")).toBeUndefined();
  });

  it("each non-default description names its bound element (so the swap is self-documenting)", () => {
    // The description is embedded as JSX text by the scaffold (escaped). It should
    // reference the bound element so the generated card explains what's rendered.
    for (const m of DATA_MODELS) {
      expect(m.description, `description for ${m.key} should mention <${m.tag}>`).toContain(m.tag);
    }
  });
});
