// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  type CellRange,
  type CellValue,
  type ColourAnchor,
  ConditionalFormatError,
  type ConditionalFormatErrorCode,
  type ConditionalFormatRule,
  evaluateConditionalFormats,
  MAX_RANGE_CELLS,
  MAX_RULES,
} from "../src/apps/sheets/lib/condformat";

// These are spreadsheet data colours, not UI token choices.
const hex = (digits: string) => `#${digits}`;
const error = { error: "#DIV/0!" } as const;
const bold = { bold: true } as const;
const basic = { kind: "notBlank", style: bold } as const;
const black = hex("000000");
const white = hex("FFFFFF");
const min: ColourAnchor = { kind: "min", color: black };
const max: ColourAnchor = { kind: "max", color: white };
const scale = (
  ...anchors: [ColourAnchor, ColourAnchor] | [ColourAnchor, ColourAnchor, ColourAnchor]
): ConditionalFormatRule => ({ kind: "colorScale", anchors });
const number = (value: number, color: string): ColourAnchor => ({ kind: "number", value, color });

function matches(values: readonly CellValue[], rule: ConditionalFormatRule): boolean[] {
  return (evaluateConditionalFormats([values], [rule])[0] ?? []).map(
    (style) => Object.keys(style).length > 0,
  );
}

function rejects(values: unknown, rules: unknown, code: ConditionalFormatErrorCode) {
  expect(() =>
    evaluateConditionalFormats(values as CellRange, rules as readonly ConditionalFormatRule[]),
  ).toThrow(expect.objectContaining({ name: "ConditionalFormatError", code }));
  try {
    evaluateConditionalFormats(values as CellRange, rules as readonly ConditionalFormatRule[]);
  } catch (caught) {
    expect(caught).toBeInstanceOf(ConditionalFormatError);
  }
}

describe("conditional comparisons", () => {
  it.each([
    [">", [false, false, true]],
    [">=", [false, true, true]],
    ["<", [true, false, false]],
    ["<=", [true, true, false]],
    ["=", [false, true, false]],
    ["<>", [true, false, true]],
  ] as const)("evaluates numeric %s without coercing cells", (operator, expected) => {
    expect(
      matches([1, 2, 3, "2", true, false, null, error], {
        kind: "cellIs",
        operator,
        value: 2,
        style: bold,
      }),
    ).toEqual([...expected, false, false, false, false, false]);
  });

  it.each([
    [">", [false, false, true]],
    [">=", [false, true, true]],
    ["<", [true, false, false]],
    ["<=", [true, true, false]],
    ["=", [false, true, false]],
    ["<>", [true, false, true]],
  ] as const)("evaluates case-insensitive string %s", (operator, expected) => {
    expect(
      matches(["ALPHA", "brAVo", "Charlie", 2, error], {
        kind: "cellIs",
        operator,
        value: "BRAVO",
        style: bold,
      }),
    ).toEqual([...expected, false, false]);
  });

  it.each(["between", "notBetween"] as const)("evaluates inclusive numeric %s", (operator) => {
    const result = [false, true, true, true, false];
    expect(
      matches([-1, 0, 1, 2, 3, "1", null, error], {
        kind: "cellIs",
        operator,
        min: 0,
        max: 2,
        style: bold,
      }),
    ).toEqual([
      ...(operator === "between" ? result : result.map((value) => !value)),
      false,
      false,
      false,
    ]);
  });

  it("compares string bounds ignoring case and accepts equal bounds", () => {
    expect(
      matches(["A", "b", "C", "d", 1], {
        kind: "cellIs",
        operator: "between",
        min: "a",
        max: "C",
        style: bold,
      }),
    ).toEqual([true, true, true, false, false]);
    expect(
      matches([1, 2, 3], { kind: "cellIs", operator: "between", min: 2, max: 2, style: bold }),
    ).toEqual([false, true, false]);
    expect(
      matches(["é", "É", "e"], { kind: "cellIs", operator: "=", value: "É", style: bold }),
    ).toEqual([true, true, false]);
  });
});

describe("text, presence, error and duplicate rules", () => {
  it.each([
    ["textContains", "AMP", [true, true, false, false]],
    ["beginsWith", "EXA", [true, false, false, false]],
    ["endsWith", ".ORG", [true, false, true, false]],
  ] as const)("evaluates %s ignoring case", (kind, text, expected) => {
    expect(
      matches(["Example.org", "an EXAMPLE", "other.ORG", "else", 12, true, null, error], {
        kind,
        text,
        style: bold,
      }),
    ).toEqual([...expected, false, false, false, false]);
  });

  it("handles empty search text literally", () => {
    for (const kind of ["textContains", "beginsWith", "endsWith"] as const) {
      expect(matches(["", "x", null, 1], { kind, text: "", style: bold })).toEqual([
        true,
        true,
        false,
        false,
      ]);
    }
  });

  it.each([
    ["blank", [true, true, false, false, false, false, false]],
    ["notBlank", [false, false, true, true, true, true, true]],
    ["error", [false, false, false, false, false, false, true]],
    ["noError", [true, true, true, true, true, true, false]],
  ] as const)("evaluates %s on every cell type", (kind, expected) => {
    expect(matches([null, "", " ", 0, false, "#N/A", error], { kind, style: bold })).toEqual(
      expected,
    );
  });

  it("counts duplicates across rows, separates types and excludes blank/error cells", () => {
    const values: CellRange = [
      ["Dana Example", "DANA EXAMPLE", 1, "1", true, false],
      [0, -0, 1, true, null, ""],
      [error, { error: "#DIV/0!" }, "Solo", 2, " ", " "],
    ];
    const duplicate = [
      [true, true, true, false, true, false],
      [true, true, true, true, false, false],
      [false, false, false, false, true, true],
    ];
    expect(
      evaluateConditionalFormats(values, [{ kind: "duplicate", style: bold }]).map((row) =>
        row.map((style) => style.bold === true),
      ),
    ).toEqual(duplicate);
    expect(
      evaluateConditionalFormats(values, [{ kind: "unique", style: bold }]).map((row) =>
        row.map((style) => style.bold === true),
      ),
    ).toEqual([
      [false, false, false, true, false, true],
      [false, false, false, false, false, false],
      [false, false, true, true, false, false],
    ]);
  });
});

describe("numeric population rules", () => {
  const values = [1, 1, 2, 3, 4, 4, "999", true, null, error] as const;
  it.each([
    ["top", [false, false, false, false, true, true]],
    ["bottom", [true, true, false, false, false, false]],
  ] as const)("includes ties in %s N and N percent", (kind, expected) => {
    for (const options of [
      { count: 1 },
      { count: 2 },
      { count: 1, percent: true },
      { count: 30, percent: true },
    ]) {
      expect(matches(values, { kind, ...options, style: bold })).toEqual([
        ...expected,
        false,
        false,
        false,
        false,
      ]);
    }
    expect(matches(values, { kind, count: 100, style: bold })).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(matches(values, { kind, count: 100, percent: true, style: bold })).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("rounds percentages upward without a floating point off-by-one", () => {
    const cells = Array.from({ length: 100 }, (_, index) => index);
    expect(
      matches(cells, { kind: "top", count: 28, percent: true, style: bold }).filter(Boolean),
    ).toHaveLength(28);
    expect(matches([1, 2, 3], { kind: "bottom", count: 34, percent: true, style: bold })).toEqual([
      true,
      true,
      false,
    ]);
    expect(
      matches([1, 2, 3], { kind: "top", count: Number.MIN_VALUE, percent: true, style: bold }),
    ).toEqual([false, false, true]);
  });

  it.each([
    "top",
    "bottom",
  ] as const)("selects the exact fractional percentage cutoff for %s rules", (kind) => {
    for (const [length, count, selected] of [
      [375, 8.8, 33],
      [750, 4.4, 33],
      [375, 8.800000000000002, 34],
      [375, 8.799999999999999, 33],
      [100, 1e-7, 1],
    ] as const) {
      const cells = Array.from({ length }, (_, index) => index);
      expect(matches(cells, { kind, count, percent: true, style: bold })).toEqual(
        cells.map((value) => (kind === "top" ? value >= length - selected : value < selected)),
      );
    }
  });

  it.each([
    ["aboveAverage", [false, false, true]],
    ["belowAverage", [true, false, false]],
  ] as const)("evaluates strict %s across only numeric cells", (kind, expected) => {
    expect(matches([0, 5, 10, "100", false, null, error], { kind, style: bold })).toEqual([
      ...expected,
      false,
      false,
      false,
      false,
    ]);
    expect(matches([0, 0], { kind, style: bold })).toEqual([false, false]);
  });

  it("handles extreme and subnormal averages without overflowing", () => {
    const largest = Number.MAX_VALUE;
    expect(matches([largest, largest, largest / 2], { kind: "aboveAverage", style: bold })).toEqual(
      [true, true, false],
    );
    expect(matches([-largest, largest, 1, 0], { kind: "aboveAverage", style: bold })).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(
      matches([Number.MIN_VALUE, Number.MIN_VALUE * 3], { kind: "belowAverage", style: bold }),
    ).toEqual([true, false]);
  });

  it.each([1, -1])("retains small residuals after overflow and cancellation, sign %s", (sign) => {
    const largest = Number.MAX_VALUE;
    const cells = [-largest, -largest, 0, sign * 1e-100, largest, largest];
    const kind = sign === 1 ? "belowAverage" : "aboveAverage";
    expect(
      evaluateConditionalFormats(
        [cells],
        [
          { kind, style: bold, stopIfTrue: true },
          { kind: "notBlank", style: { italic: true } },
        ],
      ),
    ).toEqual([
      cells.map((value) => ((sign === 1 ? value <= 0 : value >= 0) ? bold : { italic: true })),
    ]);
  });

  it.each([
    [
      [0, 0],
      [false, false],
      [false, false],
    ],
    [
      [0, Number.MIN_VALUE],
      [false, false],
      [false, true],
    ],
    [
      [0, 4 * Number.MIN_VALUE],
      [true, false],
      [false, true],
    ],
    [
      [0, 1, 1, 1, 1, 1].map((value) => value * Number.MIN_VALUE),
      [false, false, false, false, false, false],
      [false, true, true, true, true, true],
    ],
    [
      [0, 1, 2, 3, 4, 5].map((value) => value * Number.MIN_VALUE),
      [true, true, false, false, false, false],
      [false, false, false, true, true, true],
    ],
    [
      [0, 1, 2, 3, 4, 15].map((value) => value * Number.MIN_VALUE),
      [true, true, false, false, false, false],
      [false, false, false, true, true, true],
    ],
  ] as const)("rounds cancelled subnormal averages for residual cells %j", (residuals, below, above) => {
    const largest = Number.MAX_VALUE;
    const cells = [-largest, -largest, ...residuals, largest, largest];
    expect(matches(cells, { kind: "belowAverage", style: bold }).slice(2, -2)).toEqual(below);
    expect(matches(cells, { kind: "aboveAverage", style: bold }).slice(2, -2)).toEqual(above);
  });

  it.each([
    ["aboveAverage", [{}, {}, bold]],
    ["belowAverage", [bold, {}, {}]],
  ] as const)("keeps cells equal to the average out of %s and allows later rules", (kind, expected) => {
    for (const values of [
      [3, 4, 5],
      [-5, -4, -3],
    ]) {
      expect(evaluateConditionalFormats([values], [{ kind, style: bold }])).toEqual([expected]);
      expect(
        evaluateConditionalFormats(
          [values],
          [
            { kind, style: bold, stopIfTrue: true },
            { kind: "notBlank", style: { italic: true } },
          ],
        ),
      ).toEqual([expected.map((style) => ("bold" in style ? style : { italic: true }))]);
    }
  });

  it.each([
    ["aboveAverage", [false, false, true, true]],
    ["belowAverage", [true, true, false, false]],
  ] as const)("compensates cancellation before calculating %s", (kind, expected) => {
    expect(matches([-1e16, 0, 1, 1e16], { kind, style: bold })).toEqual(expected);
    expect(matches([-1e16, -1, 0, 1e16], { kind, style: bold })).toEqual(expected);
  });

  it.each([
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ])("preserves extreme constant averages %s", (value) => {
    for (const kind of ["aboveAverage", "belowAverage"] as const) {
      expect(matches([value, value], { kind, style: bold })).toEqual([false, false]);
    }
  });

  it.each([
    0.1, -0.1, 0.2, -0.2, 0.7, -0.7,
  ])("preserves constant decimal averages %s and allows later rules", (value) => {
    for (const length of [3, 6, 7, 10]) {
      const values = Array<number>(length).fill(value);
      for (const kind of ["aboveAverage", "belowAverage"] as const) {
        expect(matches(values, { kind, style: bold })).toEqual(values.map(() => false));
        expect(
          evaluateConditionalFormats(
            [values],
            [
              { kind, style: bold, stopIfTrue: true },
              { kind: "notBlank", style: { italic: true } },
            ],
          ),
        ).toEqual([values.map(() => ({ italic: true }))]);
      }
    }
  });

  it("does not match numeric population rules on a range without numbers", () => {
    for (const kind of ["top", "bottom"] as const) {
      expect(matches([null, "", true, error], { kind, count: 1, style: bold })).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
    for (const kind of ["aboveAverage", "belowAverage"] as const) {
      expect(matches([null, "", true, error], { kind, style: bold })).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
  });
});

describe("colour scales", () => {
  it.each([
    ["percentile", "percent"],
    ["percent", "percentile"],
  ] as const)("accepts equivalent %s and %s anchors over two samples", (first, second) => {
    for (const value of [20, 80]) {
      expect(
        evaluateConditionalFormats(
          [[0, 3]],
          [scale({ kind: first, value, color: black }, { kind: second, value, color: white })],
        ),
      ).toEqual([[{ fill: black }, { fill: white }]]);
    }
  });

  it.each([
    ["percent", "percentile"],
    ["percentile", "percent"],
  ] as const)("accepts equal %s and %s anchors", (first, second) => {
    expect(
      evaluateConditionalFormats(
        [[0, 1, 2, 3]],
        [
          scale(
            { kind: first, value: 20, color: black },
            { kind: second, value: 20, color: white },
          ),
        ],
      ),
    ).toEqual([[{ fill: black }, { fill: white }, { fill: white }, { fill: white }]]);
  });

  it("rounds the exact midpoint below a percent anchor to the nearest RGB channel", () => {
    expect(
      evaluateConditionalFormats(
        [[0, 14, 100]],
        [scale(min, { kind: "percent", value: 28, color: white })],
      ),
    ).toEqual([[{ fill: black }, { fill: hex("808080") }, { fill: white }]]);
  });

  it.each([
    [1, 2, 3],
    [1.2, 1.2000000000000002, 1.2000000000000004],
    [-1.2000000000000004, -1.2000000000000002, -1.2],
  ])("preserves the exact midpoint of %s, %s, %s", (low, middle, high) => {
    expect(evaluateConditionalFormats([[low, middle, high]], [scale(min, max)])).toEqual([
      [{ fill: black }, { fill: hex("808080") }, { fill: white }],
    ]);
  });

  it.each([
    "percent",
    "percentile",
  ] as const)("preserves equal endpoints for %s anchors", (kind) => {
    for (const value of [3, -3, Number.MAX_VALUE, Number.MIN_VALUE]) {
      for (const percent of [20, 80]) {
        expect(
          evaluateConditionalFormats(
            [[value, value]],
            [scale(min, { kind, value: percent, color: hex("FF0000") }, max)],
          ),
        ).toEqual([[{ fill: black }, { fill: black }]]);
      }
    }
  });

  it.each([
    "percent",
    "percentile",
  ] as const)("keeps %s anchors inside adjacent endpoints", (kind) => {
    for (const [low, high] of [
      [3, 3.0000000000000004],
      [-3.0000000000000004, -3],
    ] as const) {
      expect(
        evaluateConditionalFormats(
          [[low, high]],
          [scale(min, { kind, value: 1, color: white }, max)],
        ),
      ).toEqual([[{ fill: black }, { fill: white }]]);
    }
  });

  it("interpolates RGB channels, normalizes shorthand and skips nonnumeric cells", () => {
    expect(
      evaluateConditionalFormats(
        [[0, 25, 50, 75, 100, "50", true, null, error]],
        [scale({ kind: "min", color: hex("000") }, { kind: "max", color: hex("fFf") })],
      ),
    ).toEqual([
      [
        { fill: black },
        { fill: hex("404040") },
        { fill: hex("808080") },
        { fill: hex("BFBFBF") },
        { fill: white },
        {},
        {},
        {},
        {},
      ],
    ]);
  });

  it("interpolates both halves of a three-colour scale with inclusive percentile anchors", () => {
    expect(
      evaluateConditionalFormats(
        [[0, 25, 50, 75, 100]],
        [
          scale(
            { kind: "min", color: hex("FF0000") },
            { kind: "percentile", value: 50, color: hex("00FF00") },
            { kind: "max", color: hex("0000FF") },
          ),
        ],
      ),
    ).toEqual([
      [
        { fill: hex("FF0000") },
        { fill: hex("808000") },
        { fill: hex("00FF00") },
        { fill: hex("008080") },
        { fill: hex("0000FF") },
      ],
    ]);
  });

  it("distinguishes percent of min/max from interpolated percentiles including repeated values", () => {
    const cells = [[100, 0, 0, 0, 0, "1000", error]] as const;
    expect(
      evaluateConditionalFormats(cells, [
        scale(
          { kind: "percent", value: 25, color: black },
          { kind: "percent", value: 75, color: white },
        ),
      ])[0]?.slice(0, 5),
    ).toEqual([
      { fill: white },
      { fill: black },
      { fill: black },
      { fill: black },
      { fill: black },
    ]);
    expect(
      evaluateConditionalFormats(
        [[0, 10]],
        [
          scale(
            { kind: "percentile", value: 25, color: black },
            { kind: "percentile", value: 75, color: white },
          ),
        ],
      ),
    ).toEqual([[{ fill: black }, { fill: white }]]);
    expect(
      evaluateConditionalFormats(cells, [
        scale(
          { kind: "percentile", value: 0, color: black },
          { kind: "percentile", value: 100, color: white },
        ),
      ])[0]?.[0],
    ).toEqual({ fill: white });
  });

  it("clamps explicit anchors and interpolates percentile anchors between samples", () => {
    expect(
      evaluateConditionalFormats(
        [[-10, 0, 5, 10, 20]],
        [scale(number(0, black), number(10, white))],
      ),
    ).toEqual([
      [{ fill: black }, { fill: black }, { fill: hex("808080") }, { fill: white }, { fill: white }],
    ]);
    expect(
      evaluateConditionalFormats(
        [[0, 10, 20, 100]],
        [scale(min, { kind: "percentile", value: 50, color: white })],
      )[0]?.[1],
    ).toEqual({ fill: hex("AAAAAA") });
    expect(
      evaluateConditionalFormats(
        [[0, 0, 20, 100]],
        [scale(min, { kind: "percent", value: 50, color: white })],
      )[0]?.[2],
    ).toEqual({ fill: hex("666666") });
  });

  it("supports single numeric cells, constant ranges and equal anchors deterministically", () => {
    expect(evaluateConditionalFormats([[7]], [scale(min, max)])).toEqual([[{ fill: black }]]);
    expect(
      evaluateConditionalFormats(
        [[7, 7]],
        [scale(min, { kind: "percentile", value: 50, color: hex("F00") }, max)],
      ),
    ).toEqual([[{ fill: black }, { fill: black }]]);
    expect(
      evaluateConditionalFormats(
        [[0, 5, 10]],
        [scale(number(0, black), number(0, hex("F00")), number(10, white))],
      ),
    ).toEqual([[{ fill: black }, { fill: hex("FF8080") }, { fill: white }]]);
    expect(
      evaluateConditionalFormats([[-1, 0, 1]], [scale(number(0, black), number(0, white))]),
    ).toEqual([[{ fill: black }, { fill: black }, { fill: white }]]);
  });

  it("handles extreme endpoints without overflowing interpolation", () => {
    const largest = Number.MAX_VALUE;
    expect(
      evaluateConditionalFormats(
        [[-largest, 0, largest]],
        [
          scale(
            { kind: "percent", value: 0, color: black },
            { kind: "percent", value: 100, color: white },
          ),
        ],
      ),
    ).toEqual([[{ fill: black }, { fill: hex("808080") }, { fill: white }]]);
    expect(
      evaluateConditionalFormats(
        [[0, Number.MIN_VALUE, Number.MIN_VALUE * 2]],
        [scale(min, max)],
      )[0]?.[1],
    ).toEqual({ fill: hex("808080") });
  });

  it("handles overflowing percent products and spans while retaining exact endpoints", () => {
    const largest = Number.MAX_VALUE;
    for (const values of [
      [0, largest / 2, largest],
      [-largest, 0, largest],
    ]) {
      expect(
        evaluateConditionalFormats(
          [values],
          [scale(min, { kind: "percent", value: 50, color: white })],
        ),
      ).toEqual([[{ fill: black }, { fill: white }, { fill: white }]]);
    }
    expect(
      evaluateConditionalFormats(
        [[-1e16, 1]],
        [
          scale(
            { kind: "percent", value: 0, color: black },
            { kind: "percent", value: 100, color: white },
          ),
        ],
      ),
    ).toEqual([[{ fill: black }, { fill: white }]]);
  });

  it("produces no fill on a range with no numeric cells", () => {
    expect(evaluateConditionalFormats([[null, true, "2", error]], [scale(min, max)])).toEqual([
      [{}, {}, {}, {}],
    ]);
    expect(evaluateConditionalFormats([], [scale(min, max)])).toEqual([]);
  });
});

describe("ordered style precedence", () => {
  it("sets only unclaimed properties including false and empty strings", () => {
    expect(
      evaluateConditionalFormats(
        [[1, null]],
        [
          { kind: "notBlank", style: { fill: hex("abc"), bold: false, numberFormat: "" } },
          {
            kind: "noError",
            style: {
              fill: white,
              bold: true,
              italic: true,
              fontColor: hex("123"),
              underline: false,
              strikethrough: true,
              numberFormat: "0.00",
            },
          },
        ],
      ),
    ).toEqual([
      [
        {
          fill: hex("AABBCC"),
          bold: false,
          numberFormat: "",
          italic: true,
          fontColor: hex("112233"),
          underline: false,
          strikethrough: true,
        },
        {
          fill: white,
          bold: true,
          italic: true,
          fontColor: hex("112233"),
          underline: false,
          strikethrough: true,
          numberFormat: "0.00",
        },
      ],
    ]);
  });

  it("stops only matching cells, even for a matching rule with no style properties", () => {
    expect(
      evaluateConditionalFormats(
        [[1, 2, 3]],
        [
          { kind: "cellIs", operator: "=", value: 1, style: { italic: true }, stopIfTrue: true },
          { kind: "cellIs", operator: "=", value: 2, style: {}, stopIfTrue: true },
          { ...basic, stopIfTrue: false },
        ],
      ),
    ).toEqual([[{ italic: true }, {}, bold]]);
  });

  it("composes scale fills with other properties, earlier fills and later scales", () => {
    expect(
      evaluateConditionalFormats(
        [[0, 5, 10]],
        [
          { kind: "cellIs", operator: "=", value: 0, style: { fill: hex("F00") } },
          basic,
          scale(min, max),
          { kind: "noError", style: { fill: hex("0F0"), italic: true } },
          scale(number(0, white), number(10, black)),
        ],
      ),
    ).toEqual([
      [
        { fill: hex("FF0000"), bold: true, italic: true },
        { bold: true, fill: hex("808080"), italic: true },
        { bold: true, fill: white, italic: true },
      ],
    ]);
  });

  it("honours scale stopIfTrue only on numeric cells", () => {
    expect(
      evaluateConditionalFormats(
        [[0, "text", 10]],
        [{ ...scale(min, max), stopIfTrue: true }, basic],
      ),
    ).toEqual([[{ fill: black }, bold, { fill: white }]]);
  });

  it("does not mutate frozen input values, rules or styles and returns independent cells", () => {
    const rule = Object.freeze({
      kind: "notBlank",
      style: Object.freeze({ fill: hex("abc") }),
    } as const);
    const values = Object.freeze([Object.freeze([Object.freeze(error), 1, 2])]);
    const result = evaluateConditionalFormats(values, Object.freeze([rule]));
    expect(rule.style.fill).toBe(hex("abc"));
    expect(result).toEqual([
      [{ fill: hex("AABBCC") }, { fill: hex("AABBCC") }, { fill: hex("AABBCC") }],
    ]);
    expect(result[0]?.[1]).not.toBe(result[0]?.[2]);
    expect(evaluateConditionalFormats([[1, 2]], [])).toEqual([[{}, {}]]);
    expect(evaluateConditionalFormats([], [])).toEqual([]);
    const nullStyle = Object.assign(Object.create(null), { bold: true });
    expect(evaluateConditionalFormats([[1]], [{ kind: "notBlank", style: nullStyle }])).toEqual([
      [bold],
    ]);
  });
});

describe("typed rule validation", () => {
  it.each([
    null,
    undefined,
    true,
    1,
    "blank",
    [],
    new Date(),
    {},
    { kind: "unknown", style: {} },
    { ...basic, stopIfTrue: "true" },
    { ...basic, stopIfTrue: undefined },
    { ...basic, typo: 1 },
    { ...basic, count: 1 },
    { kind: "blank" },
    { kind: "blank", style: null },
    { kind: "blank", style: { border: "solid" } },
    { kind: "blank", style: { bold: "yes" } },
    { kind: "blank", style: { numberFormat: 1 } },
    { kind: "blank", style: { fill: "red" } },
    { kind: "blank", style: { fontColor: hex("12345") } },
    { kind: "blank", style: { fill: 1 } },
    { kind: "blank", style: { fill: hex("GGG") } },
    { kind: "blank", style: { fill: hex("12345678") } },
    { kind: "blank", style: { fill: `${hex("123")} ` } },
    { kind: "blank", style: { fill: `${hex("123")}\n` } },
    { kind: "cellIs", operator: "==", value: 1, style: bold },
    { kind: "cellIs", operator: "=", style: bold },
    { kind: "cellIs", operator: "=", value: null, style: bold },
    { kind: "cellIs", operator: "=", value: Infinity, style: bold },
    { kind: "cellIs", operator: "=", value: 1, min: 0, style: bold },
    { kind: "cellIs", operator: "between", min: 2, max: 1, style: bold },
    { kind: "cellIs", operator: "notBetween", min: "z", max: "a", style: bold },
    { kind: "cellIs", operator: "between", min: 1, max: "2", style: bold },
    { kind: "cellIs", operator: "between", min: 1, style: bold },
    { kind: "textContains", text: 2, style: bold },
    { kind: "top", count: 0, style: bold },
    { kind: "bottom", count: -1, style: bold },
    { kind: "top", count: 1.5, style: bold },
    { kind: "top", count: Number.MAX_SAFE_INTEGER + 1, style: bold },
    { kind: "top", count: NaN, style: bold },
    { kind: "top", count: "1", style: bold },
    { kind: "top", count: 1, percent: 1, style: bold },
    { kind: "top", count: 101, percent: true, style: bold },
    { kind: "colorScale", anchors: [min] },
    { kind: "colorScale", anchors: [min, max, min, max] },
    { kind: "colorScale", anchors: null },
    { kind: "colorScale", anchors: [min, max], style: {} },
    { kind: "colorScale", anchors: [min, { kind: "wat", color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "min", value: 0, color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "number", value: Infinity, color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "percent", value: -1, color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "percentile", value: 101, color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "percentile", color: white }] },
    { kind: "colorScale", anchors: [min, { kind: "number", value: 1, color: "bad" }] },
    { kind: "colorScale", anchors: [number(2, black), number(1, white)] },
  ])("rejects malformed rule %j even with an empty range", (rule) => {
    rejects([], [rule], "INVALID_RULE");
  });

  it("rejects sparse rule/anchor arrays and non-data object properties", () => {
    rejects([], new Array(1), "INVALID_RULE");
    rejects([], [{ kind: "colorScale", anchors: new Array(2) }], "INVALID_RULE");
    rejects([], [{ ...basic, [Symbol("unsupported")]: true }], "INVALID_RULE");
    rejects(
      [],
      [
        Object.defineProperty({ ...basic }, "style", {
          get() {
            throw new Error("must not invoke");
          },
        }),
      ],
      "INVALID_RULE",
    );
    rejects(
      [],
      [Object.defineProperty({ ...basic }, "style", { value: bold, enumerable: false })],
      "INVALID_RULE",
    );
    const phantom = new Proxy(
      {},
      { ownKeys: () => ["kind"], getOwnPropertyDescriptor: () => undefined },
    );
    rejects([], [phantom], "INVALID_RULE");
  });

  it("validates all rules even after stopIfTrue and rejects reversed resolved scale anchors", () => {
    rejects([[1]], [{ ...basic, stopIfTrue: true }, { kind: "invalid" }], "INVALID_RULE");
    rejects([[0, 10]], [scale(max, min)], "INVALID_RULE");
    rejects([[0, 10]], [scale(min, number(20, white), max)], "INVALID_RULE");
    rejects(
      [[0, 10]],
      [
        scale(
          { kind: "percentile", value: 90, color: black },
          { kind: "percent", value: 10, color: white },
        ),
      ],
      "INVALID_RULE",
    );
  });
});

describe("range validation and early size limits", () => {
  it.each([
    null,
    undefined,
    {},
    "range",
    [null],
    [1],
    [[]],
    [[1], []],
    [[1], "row"],
    new Array(1),
    [[undefined]],
    [new Array(1)],
    [[NaN]],
    [[Infinity]],
    [[-Infinity]],
    [[{}]],
    [[{ error: 1 }]],
    [[{ error: "x", extra: 1 }]],
    [[new Date()]],
    [[[]]],
  ])("rejects unsupported range %j", (range) => {
    rejects(range, [], "INVALID_RANGE");
  });

  it("accepts exactly MAX_RULES and rejects MAX_RULES + 1 before accessing input elements", () => {
    expect(MAX_RULES).toBe(100);
    expect(
      evaluateConditionalFormats(
        [[1]],
        Array.from({ length: MAX_RULES }, () => basic),
      ),
    ).toEqual([[bold]]);
    const rules = new Array(MAX_RULES + 1);
    Object.defineProperty(rules, 0, {
      get() {
        throw new Error("must not read rules");
      },
    });
    rejects([[1]], rules, "INVALID_RULE");
    rejects([], null, "INVALID_RULE");
  });

  it("accepts exactly MAX_RANGE_CELLS, returning all cells independently", () => {
    expect(MAX_RANGE_CELLS).toBe(1_000_000);
    const values = Array.from({ length: 1000 }, () => Array<CellValue>(1000).fill(null));
    const result = evaluateConditionalFormats(values, [{ kind: "blank", style: bold }]);
    expect(result).toHaveLength(1000);
    expect(result.every((row) => row.length === 1000)).toBe(true);
    expect(result[0]?.[0]).toEqual(bold);
    expect(result[999]?.[999]).toEqual(bold);
    expect(result[0]?.[0]).not.toBe(result[999]?.[999]);
  });

  it("rejects bound + 1 and oversized dimensions before reading cells or rules", () => {
    const row = new Array(MAX_RANGE_CELLS + 1);
    Object.defineProperty(row, 0, {
      get() {
        throw new Error("must not read cell");
      },
    });
    const rules = [basic];
    Object.defineProperty(rules, 0, {
      get() {
        throw new Error("must not read rule");
      },
    });
    rejects([row], rules, "RANGE_TOO_LARGE");
    const rows = new Array(MAX_RANGE_CELLS + 1);
    Object.defineProperty(rows, 0, {
      get() {
        throw new Error("must not read row");
      },
    });
    rejects(rows, [], "RANGE_TOO_LARGE");
    rejects([[0], row], [], "RANGE_TOO_LARGE");
    rejects(
      Array.from({ length: 1001 }, () => new Array(1000)),
      [],
      "RANGE_TOO_LARGE",
    );
  });
});
