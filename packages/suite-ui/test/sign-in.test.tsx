// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SignInCard,
  type SignInCardProps,
  type SignInProvider,
  type SignInRecentAccount,
} from "../src/sign-in/index.js";

const providers = [
  {
    id: "home",
    name: "Solid community",
    issuer: "https://solidcommunity.net/",
    signUpUrl: "https://solidcommunity.net/join",
    description: "This description is not shown",
  },
  { id: "inrupt", name: "Inrupt", issuer: "https://login.inrupt.com/" },
  { id: "teamid", name: "Team ID", issuer: "https://teamid.live/" },
] satisfies [SignInProvider, SignInProvider, SignInProvider];
const accounts = [
  { webId: "https://alice.example/profile#me", name: "Alice Wilder" },
  { webId: "https://bob.example/me" },
] satisfies [SignInRecentAccount, SignInRecentAccount];
function formOf(input: Element): HTMLFormElement {
  const form = input.closest("form");
  if (!form) throw new Error("Expected an input inside its form");
  return form;
}
function props(overrides: Partial<SignInCardProps> = {}): SignInCardProps {
  return {
    providers,
    onWebId: vi.fn(),
    onProvider: vi.fn(),
    onCustomProvider: vi.fn(),
    onAccount: vi.fn(),
    ...overrides,
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SignInCard", () => {
  it("shows one account list with an additional row, without a WebID form or provider buttons", () => {
    render(<SignInCard {...props({ recentAccounts: accounts })} />);
    expect(screen.getByRole("region", { name: "Choose an account" })).toBeDefined();
    const list = screen.getByRole("list", { name: "Recent accounts" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["AWAlice Wilderalice.example", "Bbob.examplebob.example", "Use another account"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("list", { name: "Providers" })).toBeNull();
    expect(document.querySelectorAll(".su-sign-in-header p")).toHaveLength(0);
  });

  it("opens sign-in without accounts and shows the short label, placeholder and divider", () => {
    render(<SignInCard {...props()} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined();
    const input = screen.getByRole("textbox", { name: "WebID" });
    expect(input.getAttribute("type")).toBe("url");
    expect(input.getAttribute("inputmode")).toBe("url");
    expect(input.getAttribute("autocomplete")).toBe("url");
    expect(input.getAttribute("placeholder")).toBe("https://you.example/profile/card#me");
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByText("or")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Back to accounts" })).toBeNull();
    expect(document.querySelector(".su-sign-in-header p")).toBeNull();
  });

  it("moves forward with heading focus and restores focus to the last row on Back", async () => {
    const user = userEvent.setup();
    render(
      <SignInCard {...props({ recentAccounts: accounts, defaultCustomProviderOpen: true })} />,
    );
    const focused: Element[] = [];
    const record = (event: FocusEvent) => {
      if (event.target instanceof Element) focused.push(event.target);
    };
    document.addEventListener("focusin", record);
    await user.click(screen.getByRole("button", { name: "Use another account" }));
    document.removeEventListener("focusin", record);
    const heading = screen.getByRole("heading", { name: "Sign in" });
    expect(document.activeElement).toBe(heading);
    // The already open address field is revealed but never focused (no mobile keyboard).
    const address = screen.getByRole("combobox", { name: "Provider address" });
    expect(focused).not.toContain(address);
    expect(heading.tabIndex).toBe(-1);
    expect(screen.getByRole("textbox", { name: "WebID" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Use another account" }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("uses defaultView only initially, applies each title to its step and handles accounts disappearing", async () => {
    const user = userEvent.setup();
    const callbacks = props({
      recentAccounts: accounts,
      defaultView: "sign-in",
      title: "Welcome back",
      accountsTitle: "Your accounts",
      subtitle: "to continue to Drive",
    });
    const { rerender } = render(<SignInCard {...callbacks} />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByText("to continue to Drive")).toBeDefined();
    rerender(<SignInCard {...callbacks} defaultView="accounts" />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Welcome back" })).toBeNull();
    rerender(
      <SignInCard
        {...callbacks}
        recentAccounts={[]}
        defaultView="accounts"
        pending={{ kind: "account", key: accounts[0].webId }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "WebID" })).toBeDefined();
  });

  it("renders only provider name/label with bundled logos or a monogram, and applies brand contrast", () => {
    render(
      <SignInCard
        {...props({
          providers: [{ ...providers[0], label: "Our community" }, providers[1], providers[2]],
        })}
      />,
    );
    const list = screen.getByRole("list", { name: "Providers" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Our community", "Inrupt", "TTeam ID"]);
    const solid = within(list).getByRole("button", { name: "Our community" });
    expect(solid.style.backgroundColor).toBe("rgb(124, 77, 255)");
    expect(solid.style.color).toBe("rgb(255, 255, 255)");
    expect(solid.querySelectorAll("svg path")).toHaveLength(5);
    const inrupt = within(list).getByRole("button", { name: "Inrupt" });
    expect(inrupt.style.backgroundColor).toBe("rgb(13, 103, 150)");
    expect(inrupt.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 14.13 54.17");
    expect(inrupt.querySelector("path")?.getAttribute("d")).toBe("M28.78,76.12v-37H40.06v37Z");
    expect(inrupt.querySelector("polygon")?.getAttribute("fill")).toBe("#7f3fff");
    const team = within(list).getByRole("button", { name: "Team ID" });
    expect(team.style.backgroundColor).toBe("rgb(245, 166, 35)");
    expect(team.style.color).toBe("rgb(17, 17, 17)");
    expect(team.querySelector(".su-sign-in-logo")?.getAttribute("aria-hidden")).toBe("true");
    // A light brand keeps a dark monogram; logo chips keep their own artwork colours.
    expect(team.querySelector<HTMLElement>(".su-sign-in-logo")?.style.color).toBe(
      "rgb(17, 17, 17)",
    );
    expect(solid.querySelector<HTMLElement>(".su-sign-in-logo")?.style.color).toBe("");
    expect(screen.queryByText(providers[0].description)).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each([
    "red",
    "#fff",
    "#11223344",
    "var(--primary)",
    "url(https://evil.example/)",
    " #112233",
    "#112233 ",
    "#zzzzzz",
  ])("ignores invalid colour override %s", (color) => {
    render(<SignInCard {...props({ providers: [{ ...providers[0], color }] })} />);
    expect(screen.getByRole("button", { name: "Solid community" }).style.backgroundColor).toBe(
      "rgb(124, 77, 255)",
    );
  });

  it.each([
    ["#1122Aa", "rgb(17, 34, 170)", "rgb(255, 255, 255)"],
    ["#FfCc00", "rgb(255, 204, 0)", "rgb(17, 17, 17)"],
  ])("applies valid colour %s and recalculates text colour", (color, background, foreground) => {
    render(<SignInCard {...props({ providers: [{ ...providers[0], color }] })} />);
    const button = screen.getByRole("button", { name: "Solid community" });
    expect(button.style.backgroundColor).toBe(background);
    expect(button.style.color).toBe(foreground);
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it.each([
    ["#1122Aa", "rgb(17, 34, 170)"],
    ["#FfCc00", "rgb(17, 17, 17)"],
  ])("tints a monogram with brand colour %s only when it is legible on white", (color, tint) => {
    render(
      <SignInCard
        {...props({
          providers: [{ id: "x", name: "Example", issuer: "https://x.example/", color }],
        })}
      />,
    );
    const chip = screen
      .getByRole("button", { name: "Example" })
      .querySelector<HTMLElement>(".su-sign-in-logo");
    expect(chip?.textContent).toBe("E");
    expect(chip?.style.color).toBe(tint);
  });

  it("uses an explicitly supplied safe logo instead of bundled artwork", () => {
    render(
      <SignInCard
        {...props({ providers: [{ ...providers[0], iconUrl: " https://home.example/icon.svg " }] })}
      />,
    );
    const button = screen.getByRole("button", { name: "Solid community" });
    expect(button.querySelector("img")?.getAttribute("src")).toBe("https://home.example/icon.svg");
    expect(button.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(button.querySelector("svg")).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//evil.example/image",
    "/local/image.png",
    "images/photo.png",
    "/\\evil.example/image",
    "/\t/evil.example/image",
    " \t\n",
  ])("ignores unsafe host URLs: %j", async (url) => {
    const imageSource = vi.spyOn(window.HTMLImageElement.prototype, "src", "set");
    render(
      <SignInCard
        {...props({
          providers: [
            { ...providers[0], issuer: "https://unknown.example/", iconUrl: url, signUpUrl: url },
          ],
          recentAccounts: [{ ...accounts[0], photoUrl: url }],
          webIdHelpHref: url === "/local/image.png" ? "help/webid" : url,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Alice Wilder/ }).textContent).toContain("AW");
    await userEvent.setup().click(screen.getByRole("button", { name: "Use another account" }));
    expect(
      screen.getByRole("button", { name: "Solid community" }).querySelector(".su-sign-in-logo")
        ?.textContent,
    ).toBe("S");
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(imageSource).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "What is a WebID?" }));
    expect(screen.getByRole("dialog", { name: "What is a WebID?" })).toBeDefined();
  });

  it("loads only an explicitly supplied absolute account photo", () => {
    const imageSource = vi.spyOn(window.HTMLImageElement.prototype, "src", "set");
    render(
      <SignInCard
        {...props({
          recentAccounts: [{ ...accounts[0], photoUrl: " https://alice.example/photo.png " }],
        })}
      />,
    );
    expect(imageSource).toHaveBeenCalledWith("https://alice.example/photo.png");
  });

  it("passes the original account and provider through their callbacks", async () => {
    const user = userEvent.setup();
    const callbacks = props({ recentAccounts: accounts });
    render(<SignInCard {...callbacks} />);
    await user.click(screen.getByRole("button", { name: /Alice Wilder/ }));
    expect(callbacks.onAccount).toHaveBeenCalledExactlyOnceWith(accounts[0]);
    await user.click(screen.getByRole("button", { name: "Use another account" }));
    await user.click(screen.getByRole("button", { name: "Inrupt" }));
    expect(callbacks.onProvider).toHaveBeenCalledExactlyOnceWith(providers[1]);
  });

  it("ignores empty submits and trims WebIDs and pasted provider URLs", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    render(<SignInCard {...callbacks} />);
    const input = screen.getByRole("textbox", { name: "WebID" });
    const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    for (const value of ["", "   "]) {
      fireEvent.change(input, { target: { value } });
      expect(button.disabled).toBe(true);
      fireEvent.submit(formOf(input));
    }
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    for (const value of [accounts[0].webId, providers[0].issuer]) {
      fireEvent.change(input, { target: { value: `  ${value}  ` } });
      await user.click(input);
      await user.keyboard("{Enter}");
      expect(callbacks.onWebId).toHaveBeenLastCalledWith(value);
    }
    expect(callbacks.onWebId).toHaveBeenCalledTimes(2);
  });

  it("toggles and focuses custom entry, deduplicates its datalist and submits only that form", async () => {
    const user = userEvent.setup();
    const callbacks = props({
      recentProviders: ["https://past.example/", "https://other.example/", "https://past.example/"],
    });
    render(<SignInCard {...callbacks} />);
    expect(screen.queryByLabelText("Provider address")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Other provider" });
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByRole("combobox", { name: "Provider address" });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("type")).toBe("url");
    const datalist = document.getElementById(input.getAttribute("list") ?? "");
    expect(
      Array.from(datalist?.querySelectorAll("option") ?? []).map((option) => option.value),
    ).toEqual(["https://past.example/", "https://other.example/"]);
    expect(
      (within(formOf(input)).getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(formOf(input));
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(formOf(input));
    expect(callbacks.onCustomProvider).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  https://custom.example/  " } });
    await user.keyboard("{Enter}");
    expect(callbacks.onCustomProvider).toHaveBeenCalledExactlyOnceWith("https://custom.example/");
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    await user.click(trigger);
    expect(screen.queryByLabelText("Provider address")).toBeNull();
  });

  it("uses initial custom expansion only once and allows hiding custom providers", async () => {
    const user = userEvent.setup();
    const callbacks = props({ defaultCustomProviderOpen: true });
    const { rerender } = render(<SignInCard {...callbacks} />);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Provider address" }));
    rerender(<SignInCard {...callbacks} defaultCustomProviderOpen={false} />);
    expect(
      screen.getByRole("button", { name: "Other provider" }).getAttribute("aria-expanded"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "Other provider" }));
    rerender(<SignInCard {...callbacks} />);
    expect(screen.queryByLabelText("Provider address")).toBeNull();
    rerender(<SignInCard {...callbacks} allowCustomProvider={false} />);
    expect(screen.queryByRole("button", { name: "Other provider" })).toBeNull();
    expect(screen.queryByLabelText("Provider address")).toBeNull();
  });

  it.each([
    { kind: "account", key: accounts[0].webId },
    { kind: "provider", key: "home" },
    { kind: "provider", key: providers[0].issuer },
    { kind: "webid", key: accounts[0].webId },
    { kind: "custom", key: "https://custom.example/" },
  ] as const)("forces the right view and disables other actions while $kind / $key is pending", async (pending) => {
    const user = userEvent.setup();
    const callbacks = props({
      pending,
      recentAccounts: accounts,
      defaultView: pending.kind === "account" ? "sign-in" : "accounts",
      onCancel: vi.fn(),
      webIdHelpHref: "/help/webid",
      footer: <a href="/terms">Terms</a>,
    });
    render(<SignInCard {...callbacks} />);
    expect(
      screen.getByRole("heading", {
        name: pending.kind === "account" ? "Choose an account" : "Sign in",
      }),
    ).toBeDefined();
    const active = document.querySelector<HTMLButtonElement>('button[aria-busy="true"]');
    expect(active).not.toBeNull();
    expect(active?.querySelector(".su-sign-in-spinner")).not.toBeNull();
    expect(document.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
    expect(active?.textContent).toMatch(/Signing in( with .+)?…/u);
    if (pending.kind === "account") {
      expect(active?.querySelector('[data-slot="avatar"]')?.textContent).toBe("AW");
      expect(active?.textContent).not.toContain("alice.example");
      expect(active?.lastElementChild?.classList.contains("su-sign-in-spinner")).toBe(true);
      expect(screen.queryByRole("textbox")).toBeNull();
    } else if (pending.kind === "provider") {
      expect(active?.querySelector(".su-sign-in-logo .su-sign-in-spinner")).not.toBeNull();
      expect(active?.querySelector("path")).not.toBeNull();
      expect(active?.querySelectorAll("svg")).toHaveLength(1);
      expect(active?.textContent).toBe(`Signing in with ${providers[0].name}…`);
    }
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(button.textContent !== "Cancel");
      if (button.textContent !== "Cancel") await user.click(button);
    }
    for (const input of document.querySelectorAll("input")) {
      expect(input.disabled).toBe(true);
      fireEvent.submit(formOf(input));
    }
    for (const text of ["Get a pod", "What is a WebID?"]) {
      const link = screen.getByText(text);
      expect(link.getAttribute("href")).toBeNull();
      expect(link.getAttribute("aria-disabled")).toBe("true");
      expect(link.tabIndex).toBe(-1);
    }
    expect(screen.getByText("Terms").parentElement?.hasAttribute("inert")).toBe(true);
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    expect(callbacks.onCustomProvider).not.toHaveBeenCalled();
    expect(callbacks.onProvider).not.toHaveBeenCalled();
    expect(callbacks.onAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it("preserves the custom draft after pending clears and omits Cancel without a callback", async () => {
    const user = userEvent.setup();
    const callbacks = props({ defaultCustomProviderOpen: true });
    const { rerender } = render(<SignInCard {...callbacks} />);
    const input = screen.getByRole("combobox", { name: "Provider address" });
    await user.type(input, "https://custom.example/");
    rerender(
      <SignInCard {...callbacks} pending={{ kind: "custom", key: "https://custom.example/" }} />,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    rerender(<SignInCard {...callbacks} pending={null} />);
    expect((input as HTMLInputElement).value).toBe("https://custom.example/");
    await user.click(within(formOf(input)).getByRole("button", { name: "Continue" }));
    expect(callbacks.onCustomProvider).toHaveBeenCalledExactlyOnceWith("https://custom.example/");
  });

  it("places each error with the last action and hides it on the other step", async () => {
    const user = userEvent.setup();
    const callbacks = props({ recentAccounts: accounts });
    const { rerender } = render(<SignInCard {...callbacks} />);
    await user.click(screen.getByRole("button", { name: /Alice Wilder/ }));
    rerender(<SignInCard {...callbacks} error="Try again" />);
    expect(
      screen
        .getByRole("alert")
        .compareDocumentPosition(screen.getByRole("list", { name: "Recent accounts" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use another account" }));
    expect(screen.queryByRole("alert")).toBeNull();
    const webId = screen.getByRole("textbox", { name: "WebID" });
    fireEvent.change(webId, { target: { value: accounts[0].webId } });
    fireEvent.submit(formOf(webId));
    const assertInputError = (input: HTMLElement) => {
      const alert = screen.getByRole("alert");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(alert.id);
      expect(formOf(input).contains(alert)).toBe(true);
      expect(input.nextElementSibling).toBe(alert);
    };
    assertInputError(webId);
    await user.click(screen.getByRole("button", { name: "Other provider" }));
    const custom = screen.getByRole("combobox", { name: "Provider address" });
    fireEvent.change(custom, { target: { value: "https://custom.example/" } });
    fireEvent.submit(formOf(custom));
    assertInputError(custom);
    expect(webId.getAttribute("aria-invalid")).toBeNull();
    expect(webId.getAttribute("aria-describedby")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Inrupt" }));
    const providerList = screen.getByRole("list", { name: "Providers" });
    expect(providerList.previousElementSibling).toBe(screen.getByRole("alert"));
    expect(custom.getAttribute("aria-describedby")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to accounts" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Use another account" }));
    expect(providerList.isConnected).toBe(false);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    rerender(<SignInCard {...callbacks} error={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    "account",
    "provider",
    "webid",
    "custom",
  ] as const)("retains error ownership after externally started %s pending clears", (kind) => {
    const callbacks = props({
      recentAccounts: accounts,
      defaultView: kind === "account" ? "sign-in" : "accounts",
    });
    const { rerender } = render(
      <SignInCard
        {...callbacks}
        pending={{ kind, key: kind === "account" ? accounts[0].webId : "home" }}
      />,
    );
    rerender(<SignInCard {...callbacks} error="Please try again" pending={null} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: kind === "account" ? "Choose an account" : "Sign in" }),
    ).toBeDefined();
    if (kind === "custom" || kind === "webid") {
      expect(
        screen
          .getByLabelText(kind === "custom" ? "Provider address" : "WebID")
          .getAttribute("aria-describedby"),
      ).toBe(screen.getByRole("alert").id);
    } else if (kind === "provider") {
      expect(screen.getByRole("list", { name: "Providers" }).previousElementSibling).toBe(
        screen.getByRole("alert"),
      );
    }
  });

  it("generates independent field, error and datalist IDs for multiple cards", () => {
    render(
      <>
        <SignInCard
          {...props({ title: "First card", error: "First error", defaultCustomProviderOpen: true })}
        />
        <SignInCard
          {...props({
            title: "Second card",
            error: "Second error",
            defaultCustomProviderOpen: true,
          })}
        />
      </>,
    );
    for (const title of ["First card", "Second card"]) {
      const cardElement = screen.getByRole("region", { name: title });
      const card = within(cardElement);
      expect(card.getByRole("textbox", { name: "WebID" }).getAttribute("aria-describedby")).toBe(
        card.getByRole("alert").id,
      );
      const custom = card.getByRole("combobox", { name: "Provider address" });
      expect(cardElement.contains(document.getElementById(custom.getAttribute("list") ?? ""))).toBe(
        true,
      );
    }
    const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps footer content and uses the first available safe sign-up URL", () => {
    render(
      <SignInCard
        {...props({
          providers: [{ ...providers[1], signUpUrl: "javascript:alert(1)" }, providers[0]],
          footer: <p>Extra footer</p>,
        })}
      />,
    );
    const link = screen.getByRole("link", { name: "Get a pod" });
    expect(link.getAttribute("href")).toBe(providers[0].signUpUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Extra footer")).toBeDefined();
  });

  it("omits sign-up when no safe sign-up destination exists", () => {
    render(<SignInCard {...props({ providers: [] })} />);
    expect(screen.queryByRole("link", { name: "Get a pod" })).toBeNull();
    expect(screen.queryByText("New to Solid?")).toBeNull();
  });

  it("opens plain WebID help, traps focus and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<SignInCard {...props()} />);
    const trigger = screen.getByRole("button", { name: "What is a WebID?" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "What is a WebID?" });
    expect(dialog.textContent).toContain("A WebID is a web address that identifies you.");
    expect(dialog.textContent).toContain("Your provider gave you one when you made your account.");
    expect(dialog.textContent).toContain("You can sign in by choosing your provider instead.");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("disables built-in WebID help while pending", () => {
    render(<SignInCard {...props({ pending: { kind: "provider", key: "home" } })} />);
    const trigger = screen.getByRole("button", { name: "What is a WebID?" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    "https://help.example/webid",
    "http://help.example/webid",
    "/help/webid",
  ])("uses a native help link for %s", (webIdHelpHref) => {
    render(<SignInCard {...props({ webIdHelpHref })} />);
    const link = screen.getByRole("link", { name: "What is a WebID?" });
    expect(link.getAttribute("href")).toBe(webIdHelpHref);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("button", { name: "What is a WebID?" })).toBeNull();
  });

  it("keeps keyboard order on both steps and never fetches", async () => {
    const fetch = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLHttpRequest", xhr);
    const user = userEvent.setup();
    render(<SignInCard {...props({ recentAccounts: accounts })} />);
    for (const name of [/Alice Wilder/, /bob.example/, /Use another account/]) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
    }
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sign in" }));
    const order = [
      screen.getByRole("textbox", { name: "WebID" }),
      ...within(screen.getByRole("list", { name: "Providers" })).getAllByRole("button"),
      screen.getByRole("button", { name: "Other provider" }),
    ];
    for (const element of order) {
      await user.tab();
      expect(document.activeElement).toBe(element);
    }
    await user.keyboard("{Enter}");
    const custom = screen.getByRole("combobox", { name: "Provider address" });
    expect(document.activeElement).toBe(custom);
    await user.type(custom, "https://custom.example/");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Inrupt" }));
    await user.click(screen.getByRole("button", { name: "Back to accounts" }));
    await user.click(screen.getByRole("button", { name: /Alice Wilder/ }));
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it.each([
    "accounts",
    "sign-in",
  ] as const)("has no serious accessibility violations on %s with an error", async (defaultView) => {
    render(
      <main>
        <SignInCard
          {...props({
            recentAccounts: accounts,
            defaultView,
            defaultCustomProviderOpen: true,
            error: "Please try again",
          })}
        />
      </main>,
    );
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });
});

describe("SignInCard stylesheet", () => {
  const css = readFileSync("src/styles/sign-in.css", "utf8");
  function rule(selector: string) {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  }
  it("sets card and account-list radii and responsive padding", () => {
    expect(rule(".su-sign-in-card")).toMatch(/border-radius:\s*28px/);
    expect(rule(".su-sign-in-card")).toMatch(/max-width:\s*400px/);
    expect(rule(".su-sign-in-card")).toMatch(/padding:\s*var\(--space-6\)/);
    expect(css).toMatch(
      /@media \(min-width: 480px\)\s*\{\s*\.su-sign-in-card\s*\{\s*padding: var\(--space-8\)/,
    );
    expect(rule(".su-sign-in-accounts")).toMatch(/border-radius:\s*20px/);
    expect(rule(".su-sign-in-accounts > li + li")).toMatch(/border-top:\s*1px solid/);
    expect(rule(".su-sign-in-avatar")).toMatch(/width:\s*40px/);
  });
  it("sets pill radii, 48px fields, 52px providers and 32px logo chips", () => {
    expect(css).toMatch(
      /\.su-sign-in-card \[data-slot="button"\],\s*\.su-sign-in-help \[data-slot="button"\]\s*\{[^}]*min-height:\s*max\(44px, var\(--control-h\)\)/,
    );
    expect(rule('.su-sign-in-help [data-slot="button"]')).toMatch(/border-radius:\s*999px/);
    expect(rule('.su-sign-in-help [data-slot="button"]')).toMatch(
      /min-height:\s*max\(44px, var\(--control-h\)\)/,
    );
    expect(rule('.su-sign-in-card [data-slot="input"]')).toMatch(/border-radius:\s*999px/);
    expect(rule('.su-sign-in-card [data-slot="input"]')).toMatch(/min-height:\s*48px/);
    expect(rule(".su-sign-in-card .su-sign-in-provider")).toMatch(/min-height:\s*52px/);
    expect(rule(".su-sign-in-card .su-sign-in-provider")).toMatch(/border-radius:\s*999px/);
    expect(rule(".su-sign-in-logo")).toMatch(/width:\s*32px/);
    expect(rule(".su-sign-in-logo")).toMatch(/background:\s*#fff/);
    expect(rule(".su-sign-in-card .su-sign-in-back")).toMatch(/min-width:\s*44px/);
  });
  it("gives footer links 44px targets, visible focus rings and respects reduced motion", () => {
    expect(rule(".su-sign-in-footer a")).toMatch(/min-height:\s*44px/);
    expect(rule(".su-sign-in-footer a")).toMatch(/display:\s*inline-flex/);
    expect(rule(".su-sign-in-card :is(button, input, a, h2):focus-visible")).toMatch(
      /outline:\s*2px solid var\(--ring\)/,
    );
    expect(rule(".su-sign-in-card .su-sign-in-account:focus-visible")).toMatch(
      /outline-offset:\s*-3px/,
    );
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
