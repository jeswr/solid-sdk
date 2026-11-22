// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { newSlide } from "@jeswr/solid-slides";
import { expect, it } from "vitest";
import {
  elapsedTime,
  isPresenterCommand,
  keepsKey,
  presentationStep,
  presenterChannel,
  visibleSlides,
} from "../../src/apps/slides/state/presentation";
import "../drive-ui-dom";

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
it("reads the presenter channel only from a presenter window's query", () => {
  expect(presenterChannel("?presenter=abc")).toBe("abc");
  expect(presenterChannel("?presenter=")).toBeNull();
  expect(presenterChannel("")).toBeNull();
});
it("leaves Space to focused controls and typing keys to text fields", () => {
  document.body.innerHTML =
    '<button id="b">Go</button><a id="a" href="#x">Link</a><input id="i"><div id="d" tabindex="-1"><span id="s"></span></div><div role="button" id="r"></div><div contenteditable="true" id="c"></div>';
  const at = (id: string) => document.getElementById(id);
  for (const id of ["b", "a", "i", "r", "c"]) expect(keepsKey(" ", at(id))).toBe(true);
  expect(keepsKey(" ", at("s"))).toBe(false);
  expect(keepsKey(" ", at("d"))).toBe(false);
  expect(keepsKey("ArrowRight", at("b"))).toBe(false);
  expect(keepsKey("ArrowRight", at("i"))).toBe(true);
  expect(keepsKey("Home", at("c"))).toBe(true);
  expect(keepsKey(" ", null)).toBe(false);
  expect(keepsKey(" ", window)).toBe(false);
  document.body.innerHTML = "";
});
