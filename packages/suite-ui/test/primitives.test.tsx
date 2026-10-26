// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  Button,
  Calendar,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Progress,
  Slider,
  TooltipProvider,
} from "../src/index.js";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
it("IconButton pairs its name with a keyboard tooltip and prevents disabled activation", async () => {
  const onClick = vi.fn();
  render(
    <main>
      <IconButton label="Add a file" disabled onClick={onClick}>
        <span aria-hidden="true">+</span>
      </IconButton>
    </main>,
  );
  const button = screen.getByRole("button", { name: "Add a file" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.dataset.slot).toBe("button");
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  fireEvent.focus(button);
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Add a file"));
  expect(
    (
      await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })
    ).violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
it("requires a nonempty IconButton label", () =>
  expect(() => render(<IconButton label=" ">+</IconButton>)).toThrow("non-empty label"));

it.each([
  ["Next", ["February 2026", "March 2026"]],
  ["Previous", ["December 2025", "November 2025"]],
] as const)("retains controlled Calendar navigation focus when moving %s", (direction, months) => {
  function ControlledCalendar() {
    const [month, setMonth] = useState(new Date(2026, 0, 1));
    return <Calendar month={month} onMonthChange={setMonth} />;
  }
  render(<ControlledCalendar />);
  const label = `Go to the ${direction} Month`;
  const button = screen.getByRole("button", { name: label });
  button.focus();
  for (const month of months) {
    // A keyboard-activated native button dispatches a click while retaining focus.
    fireEvent.click(button);
    expect(screen.getByText(month)).toBeDefined();
    expect(screen.getByRole("button", { name: label })).toBe(button);
    expect(document.activeElement).toBe(button);
  }
});

it.each([
  { props: {}, expected: ["0"] },
  { props: { min: 10, max: 50 }, expected: ["10"] },
  { props: { defaultValue: [25] }, expected: ["25"] },
  { props: { defaultValue: [20, 80] }, expected: ["20", "80"] },
  { props: { value: [30] }, expected: ["30"] },
  { props: { value: [30, 70], defaultValue: [10] }, expected: ["30", "70"] },
])("submits one Slider form value per thumb: $expected", ({ props, expected }) => {
  const { container } = render(
    <form>
      <Slider name="volume" {...props} />
    </form>,
  );
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  expect(screen.getAllByRole("slider").map((thumb) => thumb.getAttribute("aria-valuenow"))).toEqual(
    expected,
  );
  // Radix uses array field names for ranges and the literal name for a single thumb.
  expect(Array.from(new FormData(form ?? undefined).entries())).toEqual(
    expected.map((value) => [expected.length > 1 ? "volume[]" : "volume", value]),
  );
});

it("updates a default Slider's single submitted value from the keyboard", () => {
  const { container } = render(
    <form>
      <Slider name="volume" />
    </form>,
  );
  const thumb = screen.getByRole("slider", { name: "Value" });
  thumb.focus();
  fireEvent.keyDown(thumb, { key: "ArrowRight" });
  expect(document.activeElement).toBe(thumb);
  expect(thumb.getAttribute("aria-valuenow")).toBe("1");
  expect(new FormData(container.querySelector("form") ?? undefined).getAll("volume")).toEqual([
    "1",
  ]);
});

it.each([true, false])("guards IconButton activation handlers when disabled=%s", (disabled) => {
  const activate = vi.fn();
  render(
    <IconButton
      label="Actions"
      disabled={disabled}
      onClick={activate}
      onDoubleClick={activate}
      onKeyDown={activate}
      onKeyUp={activate}
      onPointerDown={activate}
      onPointerUp={activate}
      onMouseDown={activate}
      onMouseUp={activate}
    >
      +
    </IconButton>,
  );
  const button = screen.getByRole("button", { name: "Actions" });
  fireEvent.click(button);
  fireEvent.doubleClick(button);
  fireEvent.keyDown(button, { key: "Enter" });
  fireEvent.keyUp(button, { key: "Enter" });
  fireEvent.pointerDown(button, { button: 0 });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.mouseDown(button, { button: 0 });
  fireEvent.mouseUp(button, { button: 0 });
  expect(activate).toHaveBeenCalledTimes(disabled ? 0 : 8);
  // Disabled controls remain in the tab order, and Tab must keep its native action.
  expect(button.tabIndex).toBe(0);
  expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
});

it.each([
  "Enter",
  " ",
  "ArrowDown",
  "pointer",
])("prevents disabled IconButton dropdown activation via %s and re-enables it", async (activation) => {
  function Actions({ disabled }: { disabled: boolean }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="File actions" disabled={disabled}>
            +
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename file</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const { rerender } = render(<Actions disabled />);
  const button = screen.getByRole("button", { name: "File actions" });
  const activate = () => {
    if (activation === "pointer") {
      fireEvent(
        button,
        new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
      );
    } else {
      fireEvent.keyDown(button, { key: activation });
    }
  };
  activate();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("menu")).toBeNull();
  button.focus();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("File actions"));
  expect(document.activeElement).toBe(button);
  rerender(<Actions disabled={false} />);
  activate();
  expect(await screen.findByRole("menu")).toBeDefined();
  expect(button.getAttribute("aria-expanded")).toBe("true");
});
it("exposes determinate and unknown progress correctly", () => {
  render(
    <>
      <Progress value={40} aria-label="Upload" />
      <Progress value={null} aria-label="Preparing" />
    </>,
  );
  expect(screen.getByRole("progressbar", { name: "Upload" }).getAttribute("aria-valuenow")).toBe(
    "40",
  );
  expect(
    screen.getByRole("progressbar", { name: "Preparing" }).getAttribute("aria-valuenow"),
  ).toBeNull();
});
it.each([
  [0, 10, "translateX(-100%)", "0"],
  [5, 10, "translateX(-50%)", "5"],
  [10, 10, "translateX(-0%)", "10"],
  [40, undefined, "translateX(-60%)", "40"],
  [null, 10, "translateX(-100%)", null],
  [undefined, 10, "translateX(-100%)", null],
] as const)("normalizes progress %s against max %s", (value, max, transform, accessibleValue) => {
  render(
    <Progress
      {...(value === undefined ? {} : { value })}
      {...(max === undefined ? {} : { max })}
      aria-label="Upload"
    />,
  );
  const progress = screen.getByRole("progressbar", { name: "Upload" });
  expect(progress.getAttribute("aria-valuemax")).toBe(String(max ?? 100));
  expect(progress.getAttribute("aria-valuenow")).toBe(accessibleValue);
  expect(
    progress.querySelector<HTMLElement>('[data-slot="progress-indicator"]')?.style.transform,
  ).toBe(transform);
});
it.each([0, -1, Number.NaN])("uses Radix's fallback for an invalid maximum %s", (max) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<Progress value={50} max={max} aria-label="Upload" />);
    const progress = screen.getByRole("progressbar", { name: "Upload" });
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(
      progress.querySelector<HTMLElement>('[data-slot="progress-indicator"]')?.style.transform,
    ).toBe("translateX(-50%)");
  } finally {
    error.mockRestore();
  }
});
it("opens an accessible dialog and restores focus on close", async () => {
  render(
    <TooltipProvider>
      <Dialog>
        <DialogTrigger asChild>
          <Button>Rename</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>Choose a new name.</DialogDescription>
          <DialogClose asChild>
            <Button>Save</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Rename" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Rename file" });
  expect(
    (await axe.run(dialog, { rules: { "color-contrast": { enabled: false } } })).violations,
  ).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("opens a context menu from Shift+F10", async () => {
  render(
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button>File actions</Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Open file</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "File actions" }), {
    key: "F10",
    shiftKey: true,
  });
  expect(await screen.findByRole("menu")).toBeDefined();
});
