// AUTHORED-BY Codex (GPT-6.1 Sol)
import { newSlide } from "@jeswr/solid-slides";
import { expect, it } from "vitest";
import {
  elapsedTime,
  isPresenterCommand,
  presentationStep,
  visibleSlides,
} from "../../src/apps/slides/state/presentation";

it("maps presenter keys and clamps every boundary", () => {
  for (const key of ["ArrowRight", "ArrowDown", " ", "PageDown"]) {
    expect(presentationStep(key, 0, 3)).toBe(1);
    expect(presentationStep(key, 2, 3)).toBe(2);
  }
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
    expect(presentationStep(key, 2, 3)).toBe(1);
    expect(presentationStep(key, 0, 3)).toBe(0);
  }
  expect(presentationStep("Home", 2, 3)).toBe(0);
  expect(presentationStep("End", 0, 3)).toBe(2);
  expect(presentationStep("End", 0, 0)).toBe(0);
  expect(presentationStep("Escape", 0, 0)).toBe("exit");
  expect(presentationStep("x", 0, 3)).toBeUndefined();
  expect(isPresenterCommand({ key: "ArrowRight" })).toBe(true);
  for (const value of [null, 1, "hello", {}, { key: 3 }, { key: "x" }])
    expect(isPresenterCommand(value)).toBe(false);
});
it("skips hidden slides and formats a non-negative timer", () => {
  expect(
    visibleSlides([{ ...newSlide("hidden"), hidden: true }, newSlide("shown")]).map((s) => s.id),
  ).toEqual(["shown"]);
  expect(elapsedTime(1000, 0)).toBe("0:00");
  expect(elapsedTime(0, 125999)).toBe("2:05");
});
