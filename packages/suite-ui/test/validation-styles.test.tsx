// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Checkbox, Input, Select, SelectTrigger, Textarea } from "../src/index.js";

afterEach(cleanup);

it("keeps invalid borders above adapter defaults and checked checkbox styling", () => {
  // jsdom cannot resolve custom properties; substitute colours to exercise the cascade.
  const css = readFileSync("src/styles/components.css", "utf8")
    .replaceAll("var(--input)", "gray")
    .replaceAll("var(--border)", "gray")
    .replaceAll("var(--primary)", "blue")
    .replaceAll("var(--destructive)", "red");
  render(
    <>
      <style>{`
        @layer utilities {
          .invalid[aria-invalid="true"] { border-color: red; }
        }
        ${css}
      `}</style>
      <Input aria-label="Name" aria-invalid className="invalid" />
      <Textarea aria-label="Description" aria-invalid className="invalid" />
      <Select>
        <SelectTrigger aria-label="Role" aria-invalid className="invalid" />
      </Select>
      <Checkbox aria-label="Selection" aria-invalid className="invalid" />
      <Checkbox aria-label="Checked selection" defaultChecked aria-invalid className="invalid" />
      <Checkbox
        aria-label="Mixed selection"
        defaultChecked="indeterminate"
        aria-invalid
        className="invalid"
      />
      <Input aria-label="Valid name" />
    </>,
  );
  for (const label of [
    "Name",
    "Description",
    "Role",
    "Selection",
    "Checked selection",
    "Mixed selection",
  ])
    expect(getComputedStyle(screen.getByLabelText(label)).borderTopColor).toBe("rgb(255, 0, 0)");
  expect(getComputedStyle(screen.getByLabelText("Valid name")).borderTopColor).toBe(
    "rgb(128, 128, 128)",
  );
});
