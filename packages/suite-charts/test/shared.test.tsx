// AUTHORED-BY Codex GPT-6
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extent, XAxis } from "../src/shared.js";

afterEach(() => vi.restoreAllMocks());

describe("chart domains", () => {
  it.each([
    [0.3, 0.1 + 0.2],
    [1, 1 + 2.2e-16],
    [1e20, 1e20 + 1e6],
  ])("pads a span containing only float noise (%s, %s)", (a, b) => {
    const [min, max] = extent([a, b]);
    expect(min).toBeLessThan(a);
    expect(max).toBeGreaterThan(b);
    expect(max - min).toBeGreaterThan(Math.abs(a) * 0.09);
  });
  it("pads constant time domains by one day, including the Unix epoch", () => {
    for (const time of [0, Date.UTC(2026, 10, 11)]) {
      expect(extent([time], false, true)).toEqual([time - 86_400_000, time + 86_400_000]);
    }
  });
  it("uses [0, 1] for all-zero values and preserves the sign of bar domains", () => {
    expect(extent([0, 0])).toEqual([0, 1]);
    expect(extent([0, 0], true)).toEqual([0, 1]);
    expect(extent([1e-10], true)[0]).toBe(0);
    expect(extent([-1e-10], true)[1]).toBe(0);
    expect(extent([-2, 4], true)).toEqual([-2, 4]);
  });
  it("gives repeated X axis values distinct React keys", () => {
    const error = vi.spyOn(console, "error");
    renderToString(
      <svg aria-hidden="true">
        <XAxis values={[1, 1]} scale={(n) => n} bottom={100} />
      </svg>,
    );
    expect(error).not.toHaveBeenCalled();
  });
});
