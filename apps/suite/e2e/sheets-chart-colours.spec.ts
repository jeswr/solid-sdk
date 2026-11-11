// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartSvg } from "../src/apps/sheets/components/chart-workspace";
import type { ChartSpec } from "../src/apps/sheets/lib/charts/spec";

const suiteTokens = readFileSync(
  new URL("../../../packages/suite-ui/src/styles/tokens.css", import.meta.url),
  "utf8",
);
const sheetsCss = readFileSync(
  new URL("../src/apps/sheets/components/sheets.css", import.meta.url),
  "utf8",
);

test("computes distinct pie fills, line strokes and legend swatches in Chromium for light and dark themes", async ({
  page,
}) => {
  const spec: ChartSpec = {
    id: "colours",
    sheetId: "data",
    range: "A1:F3",
    title: "Palette",
    type: "pie",
    legend: true,
    series: "columns",
  };
  const markup = renderToStaticMarkup(
    createElement(
      "main",
      {},
      createElement(
        "section",
        { id: "pie" },
        createElement(ChartSvg, {
          spec,
          values: [
            ["Label", "Value"],
            ["A", 1],
            ["B", 2],
            ["C", 3],
            ["D", 4],
            ["E", 5],
          ],
        }),
      ),
      createElement(
        "section",
        { id: "line" },
        createElement(ChartSvg, {
          spec: { ...spec, type: "line" },
          values: [
            [1, 2, 3, 4, 5],
            [2, 3, 4, 5, 6],
          ],
        }),
      ),
    ),
  );
  await page.setContent(markup);
  await page.addStyleTag({ content: `${suiteTokens}\n${sheetsCss}` });
  const themeColours: string[][] = [];
  for (const dark of [false, true]) {
    const colours = await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      const probe = document.createElement("span");
      document.body.append(probe);
      const expected = Array.from({ length: 5 }, (_, i) => {
        probe.style.color = `var(--chart-${i + 1})`;
        return getComputedStyle(probe).color;
      });
      probe.remove();
      const fills = [...document.querySelectorAll("#pie path")].map(
        (node) => getComputedStyle(node).fill,
      );
      const strokes = [...document.querySelectorAll("#line path")].map(
        (node) => getComputedStyle(node).stroke,
      );
      const swatches = [...document.querySelectorAll("#pie .sht-chart-legend span")].map(
        (node) => getComputedStyle(node).backgroundColor,
      );
      const tokens = Array.from({ length: 5 }, (_, i) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(`--chart-${i + 1}`)
          .trim(),
      );
      return { expected, fills, strokes, swatches, tokens };
    }, dark);
    expect(colours.tokens.every((value) => value.length > 0)).toBe(true);
    expect(new Set(colours.expected).size).toBe(5);
    expect(colours.fills).toEqual(colours.expected);
    expect(colours.strokes).toEqual(colours.expected);
    expect(colours.swatches).toEqual(colours.expected);
    themeColours.push(colours.expected);
  }
  expect(themeColours[0]?.every((value, i) => value !== themeColours[1]?.[i])).toBe(true);
});
