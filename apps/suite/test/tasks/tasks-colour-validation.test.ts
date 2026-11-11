// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DataFactory, SCHEMA } from "../../src/apps/tasks/lib/model/rdf";
import {
  PROJECT_COLOURS,
  projectColour,
  projectColourStyle,
} from "../../src/apps/tasks/lib/views/project-colours";
import { deferred } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

describe("project colour validation", () => {
  it("maps twelve named hex colours to tokens, accepting case differences", () => {
    expect(PROJECT_COLOURS).toHaveLength(12);
    expect(new Set(PROJECT_COLOURS.map((colour) => colour.name)).size).toBe(12);
    for (const colour of PROJECT_COLOURS) {
      expect(projectColour(colour.hex.toLowerCase())).toBe(colour);
      expect(projectColourStyle(colour.hex)).toEqual({
        backgroundColor: `var(--tsk-project-${colour.token})`,
      });
    }
  });
  it("renders missing, unknown and malformed values as neutral without interpolating pod data", () => {
    for (const value of [
      undefined,
      "",
      "blue",
      "#123",
      "#1234567",
      "#gggggg",
      "#123456",
      " #1D4ED8",
      "#1D4ED8; background: url(https://bad.test)",
    ]) {
      expect(projectColour(value)).toBeUndefined();
      expect(projectColourStyle(value)).toEqual({ backgroundColor: "var(--foreground-muted)" });
    }
  });
});

it("writes and clears schema:color through the store with the current If-Match validator", async () => {
  const { cache, inbox, pod, store } = await frameCache();
  const blue = "#1D4ED8";
  await cache.setProjectColor(inbox, blue.toLowerCase());
  const written = await store.readProject(inbox.url);
  expect(
    written.dataset
      .getQuads(
        DataFactory.namedNode(written.tracker.id),
        DataFactory.namedNode(`${SCHEMA}color`),
        null,
        null,
      )
      .map((quad) => quad.object.value),
  ).toEqual([blue]);
  expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(inbox.etag);
  const count = pod.mutations().length;
  await cache.setProjectColor(inbox, blue);
  expect(pod.mutations()).toHaveLength(count);
  await cache.setProjectColor(inbox, undefined);
  expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(written.etag);
  expect((await store.readProject(inbox.url)).tracker.color).toBeUndefined();
  expect(() => cache.setProjectColor(inbox, "red")).toThrow("Unknown project colour");
});

it("shows the colour optimistically, rolls back failures and retains later title edits", async () => {
  const { cache, inbox, pod, failures, store } = await frameCache();
  const response = deferred<Response>();
  pod.intercept = (request) =>
    request.method === "PUT" && request.url === inbox.url ? response.promise : undefined;
  const before = pod.mutations().length;
  const colour = cache.setProjectColor(inbox, "#1D4ED8");
  expect(cache.getSnapshot().projects[0]?.tracker.color).toBe("#1D4ED8");
  await vi.waitFor(() => expect(pod.mutations()).toHaveLength(before + 1));
  const rename = cache.renameProject(inbox, "Renamed");
  pod.intercept = undefined;
  response.resolve(new Response(null, { status: 503 }));
  await colour;
  await rename;
  expect(cache.getSnapshot().projects[0]?.tracker.color).toBeUndefined();
  expect((await store.readProject(inbox.url)).tracker.title).toBe("Renamed");
  expect(failures).toHaveBeenCalledOnce();
});

/** WCAG relative luminance, converting the suite's OKLCH surface tokens to linear sRGB. */
function surfaceLuminance(l: number, c: number, hue: number) {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return (
    0.2126 * (4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss) +
    0.7152 * (-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss) +
    0.0722 * (-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss)
  );
}

it("keeps every palette dot above 3:1 on light/dark sidebar, hover and selected backgrounds", () => {
  const css = readFileSync("src/apps/tasks/components/tasks.css", "utf8");
  const tokens = readFileSync("../../packages/suite-ui/src/styles/tokens.css", "utf8");
  for (const [index, selector] of [":root", ".dark"].entries()) {
    const palette = css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
    const surfaces = tokens.split(`${selector} {`)[1]?.split("}")[0] ?? "";
    for (const colour of PROJECT_COLOURS) {
      const hex = palette.match(new RegExp(`--tsk-project-${colour.token}: (#\\w{6})`))?.[1];
      expect(hex).toBeTruthy();
      const channels = [1, 3, 5].map((offset) => {
        const value = Number.parseInt((hex as string).slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const dot =
        (channels[0] as number) * 0.2126 +
        (channels[1] as number) * 0.7152 +
        (channels[2] as number) * 0.0722;
      for (const surface of ["surface", "surface-2", "primary-soft"]) {
        const values = surfaces
          .match(new RegExp(`--${surface}: oklch\\(([^)]+)\\)`))?.[1]
          ?.split(" ")
          .map(Number);
        if (values?.length !== 3) throw new Error(`Missing ${surface}`);
        const background = surfaceLuminance(
          values[0] as number,
          values[1] as number,
          values[2] as number,
        );
        expect(
          (Math.max(dot, background) + 0.05) / (Math.min(dot, background) + 0.05),
          `${index ? "dark" : "light"} ${colour.name} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }
});
