// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentSheet, type ConsentSheetProps } from "../src/sharing/consent-sheet.js";
import { DurationChips } from "../src/sharing/duration-chips.js";
import {
  PeoplePicker,
  type SharingPerson,
  type SharingProfile,
  type UseSharingProfile,
  validatePersonEntry,
} from "../src/sharing/people-picker.js";
import { PermissionRow, type PermissionRowProps } from "../src/sharing/permission-row.js";
import { RoleSelect } from "../src/sharing/role-select.js";
import type { SharingState } from "../src/sharing/state.js";

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();
const contact = {
  webId: "https://bram.example/profile#me",
  displayName: "Bram Kerst",
  emails: ["bram@example.com"],
};
const useProfile = () => ({ displayName: "Bram from profile", loading: false });
function Picker({
  state = { kind: "ready" },
  people = [contact],
  useProfile: profile = useProfile,
}: {
  state?: SharingState;
  people?: readonly SharingPerson[];
  useProfile?: UseSharingProfile;
}) {
  const [value, onChange] = useState<SharingPerson[]>([]);
  const [query, onQueryChange] = useState("");
  return (
    <PeoplePicker
      contacts={{ people, state }}
      {...{ value, onChange, query, onQueryChange }}
      useProfile={profile}
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
    "https://id.example/users/alice@example.org#me",
    "https://id.example/profile?email=alice@example.org",
    "https://id.example/profile#alice@example.org",
  ])("accepts an account ID containing an email: %s", (webId) => {
    expect(validatePersonEntry(webId, [])).toEqual({ valid: true, person: { webId } });
    const person = { ...contact, webId };
    expect(validatePersonEntry(webId, [person])).toEqual({ valid: true, person });
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
  describe.each([
    { name: "isComposing", composition: { isComposing: true } },
    { name: "keyCode 229", composition: { isComposing: false, keyCode: 229 } },
  ])("IME composition via $name", ({ composition }) => {
    it.each(["ArrowDown", "ArrowUp"])("ignores %s navigation", (key) => {
      render(
        <Picker people={[contact, { webId: "https://alice.example/me", displayName: "Alice" }]} />,
      );
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      expect(fireEvent.keyDown(input, { key, ...composition })).toBe(true);
      expect(input.getAttribute("aria-activedescendant")).toBeNull();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      const highlighted = screen.getByRole("option", { selected: true });
      expect(fireEvent.keyDown(input, { key, ...composition })).toBe(true);
      expect(screen.getByRole("option", { selected: true })).toBe(highlighted);
      expect(input.getAttribute("aria-activedescendant")).toBe(highlighted.id);
    });
    it("ignores Enter on a highlighted contact until composition ends", () => {
      render(<Picker />);
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const highlighted = screen.getByRole("option", { selected: true });
      expect(fireEvent.keyDown(input, { key: "Enter", ...composition })).toBe(true);
      expect(screen.queryByRole("list", { name: "Selected people" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(input.getAttribute("aria-activedescendant")).toBe(highlighted.id);

      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByRole("list", { name: "Selected people" }).textContent).toContain(
        contact.webId,
      );
    });
    it.each([
      "https://raw.example/me",
      "入力中",
    ])("ignores Enter on raw entry %s until composition ends", (query) => {
      render(<Picker people={[]} />);
      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: query } });
      expect(fireEvent.keyDown(input, { key: "Enter", ...composition })).toBe(true);
      expect(input.value).toBe(query);
      expect(screen.queryByRole("list", { name: "Selected people" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();

      fireEvent.keyDown(input, { key: "Enter" });
      if (query.startsWith("https://")) {
        expect(screen.getByRole("list", { name: "Selected people" }).textContent).toContain(query);
        expect(input.value).toBe("");
      } else {
        expect(screen.getByRole("alert").textContent).toContain("Enter an account ID");
      }
    });
  });
  it.each([1, 3])("selects the last contact with initial ArrowUp among %i suggestions", (count) => {
    const people = ["Alice", "Bob", "Chris"].slice(0, count).map((displayName) => ({
      webId: `https://${displayName.toLowerCase()}.example/profile#me`,
      displayName,
    }));
    render(<Picker people={people} useProfile={() => ({ loading: false })} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)?.id);
    expect(screen.getByRole("option", { selected: true })).toBe(options.at(-1));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      within(screen.getByRole("list", { name: "Selected people" })).getByText(
        `Account ID: ${people.at(-1)?.webId}`,
      ),
    ).toBeDefined();
  });
  it.each([
    undefined,
    "Old contact name",
  ])("searches the displayed profile name with contact name %s", (displayName) => {
    const person = { webId: contact.webId, ...(displayName ? { displayName } : {}) };
    render(<Picker people={[person]} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("option").textContent).toContain("Bram from profile");
    fireEvent.change(input, { target: { value: "bRaM fRoM pRoFiLe" } });
    expect(screen.getByRole("option").textContent).toContain("Bram from profile");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option").id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("list", { name: "Selected people" }).textContent).toContain(
      "Bram from profile",
    );
  });
  it("updates search results when a filtered contact's profile resolves or changes", () => {
    const updates = new Map<string, (profile: SharingProfile) => void>();
    function useLiveProfile(webId: string) {
      const [profile, setProfile] = useState<SharingProfile>({ loading: true });
      useEffect(() => {
        updates.set(webId, setProfile);
        return () => {
          updates.delete(webId);
        };
      }, [webId]);
      return profile;
    }
    const people = [{ webId: contact.webId }, { webId: "https://other.example/me" }];
    const { rerender } = render(<Picker people={people} useProfile={useLiveProfile} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Amelia" } });
    expect(screen.queryByRole("option")).toBeNull();
    act(() => updates.get(contact.webId)?.({ displayName: "Amelia Rivers", loading: false }));
    expect(screen.getByRole("option").textContent).toContain("Amelia Rivers");
    fireEvent.change(input, { target: { value: "Ada" } });
    expect(screen.queryByRole("option")).toBeNull();
    act(() => updates.get(contact.webId)?.({ displayName: "Ada Rivers", loading: false }));
    expect(screen.getByRole("option").textContent).toContain("Ada Rivers");
    rerender(<Picker people={[people[0] as SharingPerson]} useProfile={useLiveProfile} />);
    expect(screen.getByRole("option").textContent).toContain("Ada Rivers");
    expect(updates.has("https://other.example/me")).toBe(false);
  });
  it.each([
    [undefined, "https://bram.example/profile#me"],
    ["ArrowUp", "https://alice.example/me"],
    ["ArrowDown", "https://chris.example/me"],
  ])("preserves the highlighted contact after profile resolution before %s", (key, expectedId) => {
    const updates = new Map<string, (profile: SharingProfile) => void>();
    const people = [
      { webId: "https://alice.example/me" },
      { webId: contact.webId, displayName: "Amelia Rivers" },
      { webId: "https://chris.example/me", displayName: "Chris Rivers" },
    ];
    function useLiveProfile(webId: string) {
      const [profile, setProfile] = useState<SharingProfile>({ loading: true });
      useEffect(() => {
        updates.set(webId, setProfile);
        return () => {
          updates.delete(webId);
        };
      }, [webId]);
      return profile;
    }
    render(<Picker people={people} useProfile={useLiveProfile} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Rivers" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true }).textContent).toContain(contact.webId);

    act(() =>
      updates.get("https://alice.example/me")?.({ displayName: "Ada Rivers", loading: false }),
    );
    expect(screen.getAllByRole("option")).toHaveLength(3);
    const highlighted = screen.getByRole("option", { selected: true });
    expect(highlighted.textContent).toContain(contact.webId);
    expect(input.getAttribute("aria-activedescendant")).toBe(highlighted.id);
    if (key) fireEvent.keyDown(input, { key });
    fireEvent.keyDown(input, { key: "Enter" });
    const selected = screen.getByRole("list", { name: "Selected people" });
    expect(within(selected).getAllByRole("listitem")).toHaveLength(1);
    expect(within(selected).getByText(`Account ID: ${expectedId}`)).toBeDefined();
  });
  it("clears the highlight when its profile stops matching instead of selecting another contact", () => {
    let displayName = "Amelia Rivers";
    const people = [
      { webId: contact.webId },
      { webId: "https://chris.example/me", displayName: "Chris Rivers" },
    ];
    const useChangingProfile = (webId: string) => ({
      ...(webId === contact.webId ? { displayName } : {}),
      loading: false,
    });
    const { rerender } = render(<Picker people={people} useProfile={useChangingProfile} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Rivers" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true }).textContent).toContain(contact.webId);
    displayName = "Amelia Brooks";
    rerender(<Picker people={people} useProfile={useChangingProfile} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("list", { name: "Selected people" })).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      within(screen.getByRole("list", { name: "Selected people" })).getByText(
        "Account ID: https://chris.example/me",
      ),
    ).toBeDefined();
  });
  it("adds a raw account ID containing an email", () => {
    const webId = "https://id.example/users/alice@example.org#me";
    render(<Picker people={[]} useProfile={() => ({ loading: false })} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: webId } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      within(screen.getByRole("list", { name: "Selected people" })).getByText(
        `Account ID: ${webId}`,
      ),
    ).toBeDefined();
    expect(input.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
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
  it.each([0, 1])("dismisses only suggestions on the first Escape with %i contacts", (count) => {
    const onOpenChange = vi.fn();
    render(
      <Dialog.Root defaultOpen onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Content onOpenAutoFocus={(event) => event.preventDefault()}>
            <Dialog.Title>Share a file</Dialog.Title>
            <Dialog.Description>Choose who can access this file.</Dialog.Description>
            <Picker people={[contact].slice(0, count)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Share a file" })).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
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
      if (!screen.queryByRole("listbox"))
        fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
      const disabled = screen.getByRole("option", {
        name: new RegExp(role, "i"),
      }) as HTMLButtonElement;
      expect(disabled.getAttribute("aria-disabled")).toBe("true");
      expect(
        document.getElementById(disabled.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toContain("Not available on this storage");
      fireEvent.click(disabled);
      expect(onChange).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole("option", { name: "Editor" }));
    expect(onChange).toHaveBeenCalledWith("editor");
  });
  it("keeps the open role menu axe clean with disabled reasons", async () => {
    render(
      <RoleSelect
        value="viewer"
        onChange={vi.fn()}
        options={{ manager: { disabled: true, reason: "Not available on this storage" } }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Manager" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    const result = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
    ).toEqual([]);
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
  it.each([
    false,
    true,
  ])("requires a custom date when duration editing is disabled=%s", (disabled) => {
    const onShare = vi.fn();
    const duration = {
      value: "custom" as const,
      onChange: vi.fn(),
      ...(disabled ? { disabled: true as const, reason: "Duration is fixed" } : {}),
    };
    const { rerender } = render(
      <ConsentSheet {...consent} duration={duration} onShare={onShare} />,
    );
    const share = screen.getByRole("button", { name: "Share" }) as HTMLButtonElement;
    expect((screen.getByLabelText("Access ends on") as HTMLInputElement).disabled).toBe(disabled);
    expect(share.disabled).toBe(true);
    fireEvent.click(share);
    expect(onShare).not.toHaveBeenCalled();

    rerender(
      <ConsentSheet
        {...consent}
        duration={{ ...duration, customDate: "2027-01" }}
        onShare={onShare}
      />,
    );
    expect(share.disabled).toBe(true);
    fireEvent.click(share);
    expect(onShare).not.toHaveBeenCalled();

    rerender(
      <ConsentSheet
        {...consent}
        duration={{ ...duration, customDate: "2027-01-02" }}
        onShare={onShare}
      />,
    );
    expect(share.disabled).toBe(false);
    fireEvent.click(share);
    expect(onShare).toHaveBeenCalledOnce();
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
  it.each([true, false])("blocks consent denial offline (cached=%s)", (cached) => {
    const onCancel = vi.fn();
    render(<ConsentSheet {...consent} state={{ kind: "offline", cached }} onCancel={onCancel} />);
    const trigger = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
  it.each([
    true,
    false,
  ])("dismisses offline consent without deciding (cached=%s)", async (cached) => {
    const onOpenChange = vi.fn();
    const onCancel = vi.fn();
    const onShare = vi.fn();
    function OfflineConsent() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Review request
          </button>
          <ConsentSheet
            {...consent}
            open={open}
            onOpenChange={(next) => {
              onOpenChange(next);
              setOpen(next);
            }}
            state={{ kind: "offline", cached }}
            onCancel={onCancel}
            onShare={onShare}
          />
        </>
      );
    }
    render(<OfflineConsent />);
    const trigger = screen.getByRole("button", { name: "Review request" });
    trigger.focus();
    fireEvent.click(trigger);
    for (const name of ["Cancel", "Share"]) {
      const action = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(action.disabled).toBe(true);
      fireEvent.click(action);
    }
    const close = screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onShare).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it.each([true, false])("blocks a pending consent denial offline (cached=%s)", (cached) => {
    const onCancel = vi.fn();
    const { rerender } = render(<ConsentSheet {...consent} onCancel={onCancel} />);
    const trigger = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    fireEvent.click(trigger);
    rerender(<ConsentSheet {...consent} state={{ kind: "offline", cached }} onCancel={onCancel} />);
    const action = screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeDefined();

    rerender(<ConsentSheet {...consent} onCancel={onCancel} />);
    expect(trigger.disabled).toBe(false);
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
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
  it.each([
    true,
    false,
  ])("focuses the row header after revoking all access (expanded=%s)", async (expanded) => {
    const onRevoke = vi.fn();
    function RevocableRow() {
      const [items, setItems] = useState(permission.items);
      return (
        <PermissionRow
          {...permission}
          expanded={expanded}
          items={items}
          onRevoke={() => {
            onRevoke();
            setItems(items.map((item) => ({ ...item, checked: false })));
          }}
        />
      );
    }
    render(<RevocableRow />);
    const header = screen.getByRole("button", { name: /MaraCoach.*details/ });
    const trigger = screen.getByRole("button", { name: "Revoke all" }) as HTMLButtonElement;
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const action = screen.getByRole("button", { name: "Remove access" });
    act(() => action.focus());
    fireEvent.click(action);
    expect(onRevoke).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger.disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(header));
  });
  it.each(["Cancel", "Escape"])("returns focus to Revoke after %s", async (dismissal) => {
    const onRevoke = vi.fn();
    render(<PermissionRow {...permission} onRevoke={onRevoke} />);
    const trigger = screen.getByRole("button", { name: "Revoke all" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    if (dismissal === "Cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onRevoke).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it.each([true, false])("blocks a pending revocation offline (cached=%s)", (cached) => {
    const onRevoke = vi.fn();
    const { rerender } = render(<PermissionRow {...permission} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    rerender(
      <PermissionRow {...permission} state={{ kind: "offline", cached }} onRevoke={onRevoke} />,
    );
    const action = screen.getByRole("button", { name: "Remove access" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeDefined();

    rerender(<PermissionRow {...permission} onRevoke={onRevoke} />);
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    expect(onRevoke).toHaveBeenCalledOnce();
  });
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
