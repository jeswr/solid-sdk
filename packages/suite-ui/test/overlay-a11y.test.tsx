// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
// DS-13 fixture findings: modal popups left aria-hidden page content focusable
// (axe aria-hidden-focus) and CommandSeparator put role="separator" inside a listbox
// (axe aria-required-children).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/index.js";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

async function violations(rule: string) {
  const result = await axe.run(document.body, { runOnly: { type: "rule", values: [rule] } });
  return result.violations.flatMap((violation) => violation.nodes.map((node) => node.html));
}
function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main">Skip to main content</a>
      <main id="main">
        <h1>Files</h1>
        <a href="/files">All files</a>
        {children}
      </main>
    </>
  );
}
const pointer = (element: Element) =>
  fireEvent(element, new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));

const popups = [
  {
    name: "DropdownMenu",
    role: "menu",
    ui: (
      <DropdownMenu>
        <DropdownMenuTrigger>File actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    open: () => pointer(screen.getByRole("button", { name: "File actions" })),
    trigger: () => screen.getByRole("button", { name: "File actions" }),
  },
  {
    name: "Select",
    role: "listbox",
    ui: (
      <Select defaultValue="viewer">
        <SelectTrigger aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="viewer">Viewer</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
        </SelectContent>
      </Select>
    ),
    open: () => fireEvent.keyDown(screen.getByRole("combobox", { name: "Role" }), { key: "Enter" }),
    trigger: () => screen.getByRole("combobox", { name: "Role" }),
  },
  {
    name: "ContextMenu",
    role: "menu",
    ui: (
      <ContextMenu>
        <ContextMenuTrigger>Right click a file</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Rename</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    ),
    open: () => fireEvent.contextMenu(screen.getByText("Right click a file")),
    trigger: undefined,
  },
] as const;

it.each(popups)("$name makes the content it aria-hides inert while open", async (popup) => {
  render(<Page>{popup.ui}</Page>);
  const skip = screen.getByRole("link", { name: "Skip to main content" });
  if (popup.trigger) popup.trigger().focus();
  popup.open();
  const content = await screen.findByRole(popup.role);
  await waitFor(() => expect(skip.closest("[inert]")).not.toBeNull());
  expect(skip.closest("[aria-hidden=true]")).not.toBeNull();
  expect(content.closest("[inert]")).toBeNull();
  expect(await violations("aria-hidden-focus")).toEqual([]);

  fireEvent.keyDown(content, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole(popup.role)).toBeNull());
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  expect(skip.closest("[aria-hidden]")).toBeNull();
  if (popup.trigger) await waitFor(() => expect(document.activeElement).toBe(popup.trigger()));
});

it("leaves content another layer hid earlier as that layer left it", async () => {
  // As an open dialog leaves the page behind it: aria-hidden by the earlier layer.
  const behind = document.createElement("section");
  behind.setAttribute("aria-hidden", "true");
  behind.setAttribute("data-aria-hidden", "true");
  behind.innerHTML = '<button type="button">Behind a dialog</button>';
  document.body.append(behind);
  render(<Page>{popups[0].ui}</Page>);
  popups[0].open();
  await screen.findByRole("menu");
  const skip = screen.getByRole("link", { name: "Skip to main content", hidden: true });
  await waitFor(() => expect(skip.closest("[inert]")).not.toBeNull());
  expect(behind.hasAttribute("inert")).toBe(false);
  expect(document.querySelector("[data-radix-focus-guard][inert]")).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(behind.hasAttribute("inert")).toBe(false);
  behind.remove();
});

it("CommandSeparator is presentational inside the listbox and hides while searching", async () => {
  function Palette({ alwaysRender = false }: { alwaysRender?: boolean }) {
    return (
      <Command label="Find an action">
        <CommandInput aria-label="Find an action" />
        <CommandList>
          <CommandGroup heading="Create">
            <CommandItem>New document</CommandItem>
          </CommandGroup>
          <CommandSeparator alwaysRender={alwaysRender} className="extra" />
          <CommandGroup heading="Go to">
            <CommandItem>Drive</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    );
  }
  const { rerender } = render(<Palette />);
  const separator = () => document.querySelector('[data-slot="command-separator"]');
  expect(separator()?.getAttribute("role")).toBe("none");
  expect(separator()?.hasAttribute("cmdk-separator")).toBe(true);
  expect(separator()?.className).toContain("extra");
  expect(screen.queryByRole("separator")).toBeNull();
  expect(await violations("aria-required-children")).toEqual([]);

  fireEvent.change(screen.getByRole("combobox", { name: "Find an action" }), {
    target: { value: "drive" },
  });
  await waitFor(() => expect(separator()).toBeNull());
  rerender(<Palette alwaysRender />);
  await waitFor(() => expect(separator()).not.toBeNull());
});

it.each([
  false,
  true,
])("CommandEmpty keeps the filtered listbox accessible without becoming a keyboard target (asChild=%s)", async (asChild) => {
  const select = vi.fn();
  render(
    <Command label="Find an action">
      <CommandInput aria-label="Find an action" />
      <CommandList>
        <CommandEmpty asChild={asChild}>
          {asChild ? <p>No actions found</p> : "No actions found"}
        </CommandEmpty>
        <CommandItem onSelect={select}>Drive</CommandItem>
      </CommandList>
    </Command>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "unmatched" } });
  const empty = await screen.findByRole("option", { name: "No actions found" });
  expect(empty.getAttribute("aria-disabled")).toBe("true");
  expect(empty.getAttribute("aria-selected")).toBe("false");
  expect(await violations("aria-required-children")).toEqual([]);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-activedescendant")).toBeNull();

  fireEvent.change(input, { target: { value: "drive" } });
  await waitFor(() => expect(screen.queryByText("No actions found")).toBeNull());
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).toHaveBeenCalledOnce();
  expect(await violations("aria-required-children")).toEqual([]);
});

it("a closed Select never makes another layer's hidden content inert", async () => {
  // Radix renders a closed Select's content into a detached fragment, so its InertOutside
  // mounts while closed; a dialog that opens next must not have its hidden page made inert.
  render(
    <Page>
      <Select>
        <SelectTrigger aria-label="Sort by">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
        </SelectContent>
      </Select>
    </Page>,
  );
  const hidden = document.createElement("section");
  hidden.setAttribute("aria-hidden", "true");
  hidden.setAttribute("data-aria-hidden", "true");
  document.body.append(hidden);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  hidden.remove();
});
