// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, expect, it } from "vitest";
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  Input,
  Select,
  SelectTrigger,
  Textarea,
} from "../src/index.js";

afterEach(cleanup);

it("preserves control slots and adapter styles inside FormControl", () => {
  function Fields() {
    const form = useForm({ defaultValues: { name: "", selected: false } });
    return (
      <Form {...form}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Your name</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="selected"
          render={({ field: { value, onChange, ...field } }) => (
            <FormItem>
              <FormLabel>Selected</FormLabel>
              <FormControl>
                <Checkbox {...field} checked={value} onCheckedChange={onChange} />
              </FormControl>
              <FormDescription>Select this item</FormDescription>
            </FormItem>
          )}
        />
      </Form>
    );
  }
  const css = readFileSync("src/styles/components.css", "utf8")
    .replaceAll("var(--input)", "blue")
    .replaceAll("var(--border)", "gray");
  render(
    <>
      <style>{css}</style>
      <Fields />
    </>,
  );
  for (const [label, slot, description] of [
    ["Name", "input", "Your name"],
    ["Selected", "checkbox", "Select this item"],
  ] as const) {
    const control = screen.getByLabelText(label);
    expect(control.dataset.slot).toBe(slot);
    expect(control.hasAttribute("data-form-control")).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe("false");
    expect(
      document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(description);
    expect(getComputedStyle(control).borderTopColor).toBe("rgb(0, 0, 255)");
  }
  const checkboxStyle = getComputedStyle(screen.getByRole("checkbox"));
  expect(checkboxStyle.minWidth).toBe("24px");
  expect(checkboxStyle.minHeight).toBe("24px");
});

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
