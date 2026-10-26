// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import * as Ui from "../src/index.js";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
HTMLElement.prototype.scrollIntoView = vi.fn();

const overlays: [string, () => ReactNode][] = [
  [
    "dialog",
    () => (
      <Ui.Dialog defaultOpen>
        <Ui.DialogContent aria-describedby={undefined}>
          <Ui.DialogTitle>Rename file</Ui.DialogTitle>
          <Ui.Input aria-label="Name" />
        </Ui.DialogContent>
      </Ui.Dialog>
    ),
  ],
  [
    "alert-dialog",
    () => (
      <Ui.AlertDialog defaultOpen>
        <Ui.AlertDialogContent aria-describedby={undefined}>
          <Ui.AlertDialogTitle>Delete file?</Ui.AlertDialogTitle>
          <Ui.AlertDialogCancel>Cancel</Ui.AlertDialogCancel>
        </Ui.AlertDialogContent>
      </Ui.AlertDialog>
    ),
  ],
  [
    "sheet",
    () => (
      <Ui.Sheet defaultOpen>
        <Ui.SheetContent aria-describedby={undefined}>
          <Ui.SheetTitle>File details</Ui.SheetTitle>
        </Ui.SheetContent>
      </Ui.Sheet>
    ),
  ],
  [
    "popover",
    () => (
      <Ui.Popover defaultOpen>
        <Ui.PopoverTrigger>Options</Ui.PopoverTrigger>
        <Ui.PopoverContent>
          <Ui.Input aria-label="View name" />
        </Ui.PopoverContent>
      </Ui.Popover>
    ),
  ],
  [
    "tooltip",
    () => (
      <Ui.Tooltip defaultOpen>
        <Ui.TooltipTrigger>Help</Ui.TooltipTrigger>
        <Ui.TooltipContent>File help</Ui.TooltipContent>
      </Ui.Tooltip>
    ),
  ],
  [
    "hover-card",
    () => (
      <Ui.HoverCard defaultOpen>
        <Ui.HoverCardTrigger href="#file">File</Ui.HoverCardTrigger>
        <Ui.HoverCardContent>About this file</Ui.HoverCardContent>
      </Ui.HoverCard>
    ),
  ],
  [
    "dropdown-menu",
    () => (
      <Ui.DropdownMenu defaultOpen>
        <Ui.DropdownMenuTrigger>Actions</Ui.DropdownMenuTrigger>
        <Ui.DropdownMenuContent>
          <Ui.DropdownMenuItem>Open file</Ui.DropdownMenuItem>
        </Ui.DropdownMenuContent>
      </Ui.DropdownMenu>
    ),
  ],
  [
    "context-menu",
    () => (
      <Ui.ContextMenu>
        <Ui.ContextMenuTrigger>File actions</Ui.ContextMenuTrigger>
        <Ui.ContextMenuContent>
          <Ui.ContextMenuItem>Open file</Ui.ContextMenuItem>
        </Ui.ContextMenuContent>
      </Ui.ContextMenu>
    ),
  ],
  [
    "select",
    () => (
      <Ui.Select defaultOpen>
        <Ui.SelectTrigger aria-label="Role">
          <Ui.SelectValue />
        </Ui.SelectTrigger>
        <Ui.SelectContent>
          <Ui.SelectItem value="viewer">Viewer</Ui.SelectItem>
        </Ui.SelectContent>
      </Ui.Select>
    ),
  ],
];

for (const density of ["comfortable", "compact"] as const)
  it.each(overlays)(`carries ${density} density to portalled %s content`, async (slot, overlay) => {
    const { container } = render(
      <Ui.TooltipProvider>
        <section data-density={density}>{overlay()}</section>
      </Ui.TooltipProvider>,
    );
    if (slot === "context-menu")
      fireEvent.keyDown(screen.getByText("File actions"), { key: "F10", shiftKey: true });
    await waitFor(() => {
      const content = document.querySelector(`[data-slot="${slot}-content"]`);
      expect(content).not.toBeNull();
      expect(container.contains(content)).toBe(false);
      expect(content?.getAttribute("data-density")).toBe(density);
    });
  });

it("tracks the nearest density, including changes and removal while open", async () => {
  const { rerender } = render(<div />);
  const view = (density?: "comfortable" | "compact") => (
    <section data-density="compact">
      <div data-density={density}>{overlays[3]?.[1]()}</div>
    </section>
  );
  const content = () => document.querySelector('[data-slot="popover-content"]');
  rerender(view("comfortable"));
  await waitFor(() => expect(content()?.getAttribute("data-density")).toBe("comfortable"));
  rerender(view("compact"));
  await waitFor(() => expect(content()?.getAttribute("data-density")).toBe("compact"));
  rerender(view("comfortable"));
  await waitFor(() => expect(content()?.getAttribute("data-density")).toBe("comfortable"));
  rerender(view());
  await waitFor(() => expect(content()?.getAttribute("data-density")).toBe("compact"));
});

it("preserves density across a dialog and a nested popover portal", async () => {
  render(
    <section data-density="compact">
      <Ui.Dialog defaultOpen>
        <Ui.DialogContent aria-describedby={undefined}>
          <Ui.DialogTitle>Rename file</Ui.DialogTitle>
          <Ui.Popover>
            <Ui.PopoverTrigger>More options</Ui.PopoverTrigger>
            <Ui.PopoverContent>
              <Ui.Input aria-label="Nested name" />
            </Ui.PopoverContent>
          </Ui.Popover>
        </Ui.DialogContent>
      </Ui.Dialog>
    </section>,
  );
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  await waitFor(() =>
    expect(
      document.querySelector('[data-slot="popover-content"]')?.getAttribute("data-density"),
    ).toBe("compact"),
  );
  expect(
    screen
      .getByRole("textbox", { name: "Nested name" })
      .closest("[data-density]")
      ?.getAttribute("data-density"),
  ).toBe("compact");
});

it.each([
  "dropdown-menu",
  "context-menu",
] as const)("carries density through a portalled %s submenu", async (kind) => {
  const dropdown = kind === "dropdown-menu";
  const Root = dropdown ? Ui.DropdownMenu : Ui.ContextMenu;
  const Trigger = dropdown ? Ui.DropdownMenuTrigger : Ui.ContextMenuTrigger;
  const Content = dropdown ? Ui.DropdownMenuContent : Ui.ContextMenuContent;
  const Sub = dropdown ? Ui.DropdownMenuSub : Ui.ContextMenuSub;
  const SubTrigger = dropdown ? Ui.DropdownMenuSubTrigger : Ui.ContextMenuSubTrigger;
  const Portal = dropdown ? Ui.DropdownMenuPortal : Ui.ContextMenuPortal;
  const SubContent = dropdown ? Ui.DropdownMenuSubContent : Ui.ContextMenuSubContent;
  const Item = dropdown ? Ui.DropdownMenuItem : Ui.ContextMenuItem;
  render(
    <section data-density="compact">
      <Root>
        <Trigger>File actions</Trigger>
        <Content>
          <Sub open>
            <SubTrigger>More</SubTrigger>
            <Portal>
              <SubContent>
                <Item>Copy file</Item>
              </SubContent>
            </Portal>
          </Sub>
        </Content>
      </Root>
    </section>,
  );
  const trigger = screen.getByText("File actions");
  if (dropdown) fireEvent.keyDown(trigger, { key: "Enter" });
  else fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });
  await waitFor(() =>
    expect(
      document.querySelector(`[data-slot="${kind}-sub-content"]`)?.getAttribute("data-density"),
    ).toBe("compact"),
  );
});
