// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentSheet, type ConsentSheetProps } from "../src/sharing/consent-sheet.js";
import { DurationChips } from "../src/sharing/duration-chips.js";
import {
  PeoplePicker,
  type SharingPerson,
  validatePersonEntry,
} from "../src/sharing/people-picker.js";
import { PermissionRow, type PermissionRowProps } from "../src/sharing/permission-row.js";
import { RoleSelect } from "../src/sharing/role-select.js";
import type { SharingState } from "../src/sharing/state.js";

afterEach(cleanup);
const contact = {
  webId: "https://bram.example/profile#me",
  displayName: "Bram Kerst",
  emails: ["bram@example.com"],
};
const useProfile = () => ({ displayName: "Bram from profile", loading: false });
function Picker({ state = { kind: "ready" } }: { state?: SharingState }) {
  const [value, onChange] = useState<SharingPerson[]>([]);
  const [query, onQueryChange] = useState("");
  return (
    <PeoplePicker
      contacts={{ people: [contact], state }}
      {...{ value, onChange, query, onQueryChange, useProfile }}
    />
  );
}
const consent: ConsentSheetProps = {
  open: true,
  onOpenChange: vi.fn(),
  name: "MaraCoach",
  purpose: "suggest running playlists",
  dataTypes: [
    {
      id: "music",
      label: "Music interests",
      description: "Artists you follow.",
      count: 12,
      sources: ["Spotify"],
    },
    {
      id: "activity",
      label: "Activity",
      description: "Your exercise sessions.",
      count: 1,
      sources: ["Strava"],
    },
  ],
  selected: ["music", "activity"],
  onSelectionChange: vi.fn(),
  duration: { value: "until-revoked", onChange: vi.fn() },
  accounts: [
    { id: "personal", label: "Personal" },
    { id: "work", label: "Work" },
  ],
  accountId: "personal",
  onAccountChange: vi.fn(),
  onCancel: vi.fn(),
  onShare: vi.fn(),
};
const permission: PermissionRowProps = {
  name: "MaraCoach",
  since: "2 Oct 2026",
  expanded: true,
  onExpandedChange: vi.fn(),
  onItemChange: vi.fn(),
  onRevoke: vi.fn(),
  items: [
    {
      id: "music",
      label: "Music interests",
      feature: "Playlist suggestions",
      duration: "Until revoked",
      checked: true,
    },
  ],
};

describe("people validation", () => {
  it.each([
    "https://person.example/profile#me",
    "http://localhost:3000/me",
    " https://person.example/me ",
  ])("accepts an http(s) account ID: %s", (value) => {
    expect(validatePersonEntry(value, []).valid).toBe(true);
  });
  it.each([
    "",
    "https://",
    "ftp://person.example",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://exa mple.com",
    "https:person.example",
    "person",
  ])("rejects an invalid or unsafe account ID: %s", (value) => {
    expect(validatePersonEntry(value, []).valid).toBe(false);
  });
  it("resolves email only through known contacts and validates the resolved ID", () => {
    expect(validatePersonEntry("BRAM@example.com", [contact])).toEqual({
      valid: true,
      person: contact,
    });
    expect(validatePersonEntry("nobody@example.com", [contact])).toEqual({
      valid: false,
      message: "No account found for this email — paste their account ID",
    });
    expect(
      validatePersonEntry("bram@example.com", [{ ...contact, webId: "javascript:alert(1)" }]).valid,
    ).toBe(false);
  });
  it("selects a contact using keyboard and renders the supplied profile and Account ID", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option").id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("list", { name: "Selected people" }).textContent).toContain(
      "Bram from profile",
    );
    expect(screen.getByText(`Account ID: ${contact.webId}`)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove Bram Kerst" }));
    expect(screen.queryByRole("list", { name: "Selected people" })).toBeNull();
  });
  it("validates raw entry, duplicate entry, unknown email and dismisses suggestions", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(screen.getByRole("alert").textContent).toContain("No account found");
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
    fireEvent.change(input, { target: { value: "https://raw.example/me" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("list", { name: "Selected people" }).textContent).toContain(
      "raw.example",
    );
    fireEvent.change(input, { target: { value: "https://raw.example/me" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("This person is already added");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
  it("makes sharing read-only offline and explains why", () => {
    render(<Picker state={{ kind: "offline", cached: true }} />);
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Reconnect to change sharing")).toBeDefined();
  });
});

describe("roles and durations", () => {
  it("disables each role independently and exposes the reason as its description", () => {
    const onChange = vi.fn();
    const { rerender } = render(<RoleSelect value="viewer" onChange={onChange} />);
    for (const role of ["viewer", "commenter", "editor", "manager"] as const) {
      rerender(
        <RoleSelect
          value="viewer"
          onChange={onChange}
          options={{ [role]: { disabled: true, reason: "Not available on this storage" } }}
        />,
      );
      const disabled = screen.getByRole("radio", {
        name: new RegExp(role, "i"),
      }) as HTMLButtonElement;
      expect(disabled.disabled).toBe(true);
      expect(
        document.getElementById(disabled.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toContain("Not available on this storage");
      fireEvent.click(disabled);
      expect(onChange).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole("radio", { name: "Editor" }));
    expect(onChange).toHaveBeenCalledWith("editor");
  });
  it("disables the entire duration group including its custom date", () => {
    const onChange = vi.fn();
    render(
      <DurationChips value="custom" onChange={onChange} disabled reason="Expiry isn't supported" />,
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(radio);
    }
    expect((screen.getByLabelText("Access ends on") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Expiry isn't supported")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("emits preset and custom date changes", () => {
    const onChange = vi.fn();
    const onCustomDateChange = vi.fn();
    render(
      <DurationChips value="custom" onChange={onChange} onCustomDateChange={onCustomDateChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "1 month" }));
    expect(onChange).toHaveBeenCalledWith("month");
    fireEvent.change(screen.getByLabelText("Access ends on"), { target: { value: "2027-01-02" } });
    expect(onCustomDateChange).toHaveBeenCalledWith("2027-01-02");
  });
});

describe("consent", () => {
  it("shows purpose, sources and count, toggles all cards and switches account", () => {
    const onSelectionChange = vi.fn();
    const onAccountChange = vi.fn();
    const { rerender } = render(
      <ConsentSheet
        {...consent}
        onSelectionChange={onSelectionChange}
        onAccountChange={onAccountChange}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "To suggest running playlists, MaraCoach requests access to:",
    );
    expect(screen.getByText("Provided by Spotify")).toBeDefined();
    expect(screen.getByText("12 items")).toBeDefined();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    rerender(
      <ConsentSheet {...consent} selected={["music"]} onSelectionChange={onSelectionChange} />,
    );
    expect(screen.getByRole("checkbox", { name: "Select all" }).getAttribute("aria-checked")).toBe(
      "mixed",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["music", "activity"]);
    rerender(<ConsentSheet {...consent} onAccountChange={onAccountChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Change account" }), {
      target: { value: "work" },
    });
    expect(onAccountChange).toHaveBeenCalledWith("work");
  });
  it("blocks empty selections and incomplete custom dates, hides a single account switcher", () => {
    const { rerender } = render(
      <ConsentSheet
        {...consent}
        selected={[]}
        accounts={[{ id: "personal", label: "Personal" }]}
        purpose=""
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("MaraCoach requests access to:");
    expect((screen.getByRole("button", { name: "Share" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    rerender(<ConsentSheet {...consent} duration={{ value: "custom", onChange: vi.fn() }} />);
    expect((screen.getByRole("button", { name: "Share" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("calls Share only on activation and asks before denying via Cancel", () => {
    const onCancel = vi.fn();
    const onShare = vi.fn();
    render(<ConsentSheet {...consent} onCancel={onCancel} onShare={onShare} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("gives Cancel and Share identical computed style weight", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/styles/sharing.css", "utf8");
    document.head.append(style);
    render(<ConsentSheet {...consent} />);
    const actions = document.querySelector("[data-consent-actions]");
    expect(actions).not.toBeNull();
    const buttons = within(actions as HTMLElement).getAllByRole("button");
    const styles = buttons.map((button) => {
      const computed = getComputedStyle(button);
      return Object.fromEntries(
        [
          "width",
          "min-height",
          "font-weight",
          "background-color",
          "color",
          "border",
          "padding",
        ].map((key) => [key, computed.getPropertyValue(key)]),
      );
    });
    expect(styles[0]).toEqual(styles[1]);
    expect(buttons.map((button) => button.className)).toEqual(["su-button ", "su-button "]);
    style.remove();
  });
});

describe("permission rows", () => {
  it("emits expansion, toggles and confirmed revoke, with fallback consequence and undo", () => {
    const onItemChange = vi.fn();
    const onRevoke = vi.fn();
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <PermissionRow {...permission} {...{ onItemChange, onRevoke, onExpandedChange }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /MaraCoach.*Hide details/ }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("switch"));
    expect(onItemChange).toHaveBeenCalledWith("music", false);
    rerender(
      <PermissionRow
        {...permission}
        items={[
          { ...(permission.items[0] as NonNullable<(typeof permission.items)[0]>), checked: false },
        ]}
        onItemChange={onItemChange}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Playlist suggestions will stop working in MaraCoach",
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onItemChange).toHaveBeenLastCalledWith("music", true);
    rerender(<PermissionRow {...permission} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Remove all access for MaraCoach?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    expect(onRevoke).toHaveBeenCalledOnce();
  });
  it("keeps inherited toggles disabled with a reason and blocks Revoke", () => {
    render(
      <PermissionRow
        {...permission}
        items={[
          {
            ...(permission.items[0] as NonNullable<(typeof permission.items)[0]>),
            disabled: true,
            reason: "Inherited from Health",
          },
        ]}
      />,
    );
    const toggle = screen.getByRole("switch") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(
      document.getElementById(toggle.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Inherited from Health");
    expect((screen.getByRole("button", { name: "Revoke all" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

const states: SharingState[] = [
  { kind: "ready" },
  { kind: "loading" },
  { kind: "empty" },
  { kind: "filtered", query: "Nothing" },
  ...(["reauth", "forbidden", "not-found", "unreachable", "unsupported", "unknown"] as const).map(
    (code) => ({ kind: "error" as const, code }),
  ),
  { kind: "offline", cached: true },
  { kind: "offline", cached: false },
];
describe("accessibility", () => {
  for (const state of states) {
    it(`has no serious or critical axe issues: ${JSON.stringify(state)}`, async () => {
      render(
        <main>
          <Picker state={state} />
          <RoleSelect
            value="viewer"
            onChange={vi.fn()}
            options={{ manager: { disabled: true, reason: "Not available" } }}
          />
          <DurationChips
            value="custom"
            onChange={vi.fn()}
            disabled
            reason="Expiry isn't supported"
          />
          <PermissionRow {...permission} state={state} />
        </main>,
      );
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        result.violations.filter(
          (violation) => violation.impact === "serious" || violation.impact === "critical",
        ),
      ).toEqual([]);
      render(<ConsentSheet {...consent} state={state} onRetry={vi.fn()} onClear={vi.fn()} />);
      const modalResult = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        modalResult.violations.filter(
          (item) => item.impact === "serious" || item.impact === "critical",
        ),
      ).toEqual([]);
    });
  }
});
