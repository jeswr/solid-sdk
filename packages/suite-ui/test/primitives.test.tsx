// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import {
  Button,
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
  IconButton,
  Progress,
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
