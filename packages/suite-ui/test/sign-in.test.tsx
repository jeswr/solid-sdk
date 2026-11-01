// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SignInCard,
  type SignInCardProps,
  type SignInProvider,
  type SignInRecentAccount,
} from "../src/sign-in/index.js";

const providers = [
  {
    id: "home",
    name: "Home pod",
    issuer: "https://home.example/",
    description: "Your home for Solid",
    signUpUrl: "https://home.example/join",
  },
  {
    id: "community",
    name: "Community",
    issuer: "https://community.example/",
    description: "Free community pods",
  },
] satisfies [SignInProvider, SignInProvider];
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
afterEach(() => vi.unstubAllGlobals());

describe("SignInCard", () => {
  it("renders recent accounts, WebID form, providers and footer in visual order", () => {
    render(<SignInCard {...props({ recentAccounts: accounts, footer: <p>Extra footer</p> })} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined();
    expect(screen.getByText("Use your Solid account to continue.")).toBeDefined();
    expect(screen.getByText("Sign in with your WebID")).toBeDefined();
    expect(screen.getByText("or continue with your provider")).toBeDefined();
    const input = screen.getByRole("textbox", { name: "Your WebID" });
    expect(input.getAttribute("type")).toBe("url");
    expect(input.getAttribute("inputmode")).toBe("url");
    expect(input.getAttribute("autocomplete")).toBe("url");
    expect(input.getAttribute("placeholder")).toBe("https://you.example/profile/card#me");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Don't know it? Choose your provider below.",
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "AWContinue as Alice Wilderalice.example",
      "BContinue as bob.examplebob.example",
      "Continue",
      "HContinue with Home podYour home for Solid",
      "CContinue with CommunityFree community pods",
      "Another provider",
      "What is a WebID?",
    ]);
    const list = screen.getByRole("list", { name: "Providers" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const [home, community] = within(list).getAllByRole("button");
    expect(home?.dataset.variant).toBe("default");
    expect(community?.dataset.variant).toBe("outline");
    const link = screen.getByRole("link", { name: "Get a pod" });
    expect(link.getAttribute("href")).toBe(providers[0]?.signUpUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Extra footer")).toBeDefined();
  });

  it("overrides copy and provider labels and renders no default remote images", () => {
    render(
      <SignInCard
        {...props({
          title: "Welcome back",
          subtitle: "Choose an account.",
          providers: [{ ...providers[0], label: "Continue with Our community" }],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByText("Choose an account.")).toBeDefined();
    expect(screen.getByRole("button", { name: /Continue with Our community/ })).toBeDefined();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("passes the original provider and account to their callbacks", async () => {
    const user = userEvent.setup();
    const callbacks = props({ recentAccounts: accounts });
    render(<SignInCard {...callbacks} />);
    await user.click(screen.getByRole("button", { name: /Continue with Community/ }));
    expect(callbacks.onProvider).toHaveBeenCalledExactlyOnceWith(providers[1]);
    await user.click(screen.getByRole("button", { name: /Continue as Alice Wilder/ }));
    expect(callbacks.onAccount).toHaveBeenCalledExactlyOnceWith(accounts[0]);
  });

  it("renders only explicitly supplied provider icons as decorative images", () => {
    render(
      <SignInCard
        {...props({
          providers: [{ ...providers[0], iconUrl: "/my-provider.svg" }, providers[1]],
        })}
      />,
    );
    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toBe("/my-provider.svg");
    expect(images[0]?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("generates independent field, help, error and datalist IDs for multiple cards", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SignInCard {...props({ title: "First card", error: "First error" })} />
        <SignInCard {...props({ title: "Second card", error: "Second error" })} />
      </>,
    );
    for (const title of ["First card", "Second card"]) {
      const card = within(screen.getByRole("region", { name: title }));
      await user.click(card.getByRole("button", { name: "Another provider" }));
      const input = card.getByRole("textbox", { name: "Your WebID" });
      expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
        card.getByRole("alert").id,
      );
      const custom = card.getByRole("combobox", { name: "Provider address" });
      const list = document.getElementById(custom.getAttribute("list") ?? "");
      expect(list?.closest(".su-sign-in-card")).toBe(custom.closest(".su-sign-in-card"));
    }
    const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores empty submits and trims WebIDs and pasted provider addresses", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    render(<SignInCard {...callbacks} />);
    const input = screen.getByRole("textbox", { name: "Your WebID" });
    const button = screen.getByRole("button", { name: /^Continue$/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.submit(formOf(input));
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    for (const value of ["https://alice.example/profile#me", "https://home.example/"]) {
      fireEvent.change(input, { target: { value: `  ${value}  ` } });
      await user.click(input);
      await user.keyboard("{Enter}");
      expect(callbacks.onWebId).toHaveBeenLastCalledWith(value);
    }
    expect(callbacks.onWebId).toHaveBeenCalledTimes(2);
  });

  it("expands and focuses the custom field, shows recent issuers and submits only its form", async () => {
    const user = userEvent.setup();
    const callbacks = props({
      recentProviders: ["https://past.example/", "https://other.example/"],
    });
    render(<SignInCard {...callbacks} />);
    expect(screen.queryByLabelText("Provider address")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Another provider" });
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByRole("combobox", { name: "Provider address" });
    expect(input).toBe(document.activeElement);
    expect(input.getAttribute("type")).toBe("url");
    const datalist = document.getElementById(input.getAttribute("list") ?? "");
    expect(
      Array.from(datalist?.querySelectorAll("option") ?? []).map((option) => option.value),
    ).toEqual(callbacks.recentProviders);
    const submit = within(formOf(input)).getByRole("button", { name: "Continue" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(formOf(input));
    expect(callbacks.onCustomProvider).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  https://custom.example/  " } });
    await user.keyboard("{Enter}");
    expect(callbacks.onCustomProvider).toHaveBeenCalledExactlyOnceWith("https://custom.example/");
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    await user.click(trigger);
    expect(screen.queryByLabelText("Provider address")).toBeNull();
  });

  it("hides custom providers when disallowed and omits sign-up when unavailable", () => {
    render(<SignInCard {...props({ allowCustomProvider: false, providers: [] })} />);
    expect(screen.queryByRole("button", { name: "Another provider" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Get a pod" })).toBeNull();
    expect(screen.queryByText("New to Solid?")).toBeNull();
  });

  it("uses the next available sign-up URL", () => {
    render(
      <SignInCard
        {...props({
          providers: [providers[1], providers[0]],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "Get a pod" }).getAttribute("href")).toBe(
      providers[0]?.signUpUrl,
    );
  });

  it.each([
    { kind: "provider", key: "home" },
    { kind: "provider", key: "https://home.example/" },
    { kind: "account", key: accounts[0].webId },
    { kind: "webid", key: "https://alice.example/me" },
    { kind: "custom", key: "https://custom.example/" },
  ] as const)("disables actions and marks only the matching control busy for $kind / $key", async (pending) => {
    const user = userEvent.setup();
    const callbacks = props({ pending, recentAccounts: accounts, onCancel: vi.fn() });
    render(<SignInCard {...callbacks} />);
    const busy = screen.getByRole("button", { name: /Signing in…/ });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("svg")).not.toBeNull();
    expect(document.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
    for (const control of screen.getAllByRole("button")) {
      expect((control as HTMLButtonElement).disabled).toBe(control.textContent !== "Cancel");
      if (control !== screen.getByRole("button", { name: "Cancel" })) await user.click(control);
    }
    for (const input of document.querySelectorAll("input")) {
      expect(input.disabled).toBe(true);
      fireEvent.submit(formOf(input));
    }
    expect(screen.queryByRole("link")).toBeNull();
    expect(callbacks.onWebId).not.toHaveBeenCalled();
    expect(callbacks.onCustomProvider).not.toHaveBeenCalled();
    expect(callbacks.onProvider).not.toHaveBeenCalled();
    expect(callbacks.onAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it("updates an in-flight custom form and recovers after cancellation", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const { rerender } = render(<SignInCard {...callbacks} />);
    await user.click(screen.getByRole("button", { name: "Another provider" }));
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

  it("renders one error associated with the last submitted input and keeps helper text", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const { rerender } = render(<SignInCard {...callbacks} error="Please try again." />);
    const webId = screen.getByRole("textbox", { name: "Your WebID" });
    const assertDescribed = (input: HTMLElement, described: boolean) => {
      expect(
        input.getAttribute("aria-describedby")?.split(" ").includes(screen.getByRole("alert").id) ??
          false,
      ).toBe(described);
      expect(input.getAttribute("aria-invalid")).toBe(described ? "true" : null);
    };
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    assertDescribed(webId, true);
    expect(webId.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Another provider" }));
    const custom = screen.getByRole("combobox", { name: "Provider address" });
    await user.type(custom, "https://custom.example/");
    await user.keyboard("{Enter}");
    rerender(<SignInCard {...callbacks} error="That provider could not sign you in." />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    assertDescribed(custom, true);
    assertDescribed(webId, false);
    await user.type(webId, "https://alice.example/me");
    await user.keyboard("{Enter}");
    assertDescribed(webId, true);
    assertDescribed(custom, false);
    await user.click(screen.getByRole("button", { name: /Continue with Home pod/ }));
    assertDescribed(webId, false);
    rerender(<SignInCard {...callbacks} error={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens plain WebID help, traps focus, and restores the trigger on Escape", async () => {
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

  it("uses a native help link when supplied", () => {
    render(<SignInCard {...props({ webIdHelpHref: "https://help.example/webid" })} />);
    expect(screen.getByRole("link", { name: "What is a WebID?" }).getAttribute("href")).toBe(
      "https://help.example/webid",
    );
    expect(screen.queryByRole("button", { name: "What is a WebID?" })).toBeNull();
  });

  it("keeps keyboard focus in visual order and makes no network requests", async () => {
    const fetch = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLHttpRequest", xhr);
    const user = userEvent.setup();
    render(<SignInCard {...props({ recentAccounts: accounts })} />);
    const order = [
      screen.getByRole("button", { name: /Continue as Alice/ }),
      screen.getByRole("button", { name: /Continue as bob/ }),
      screen.getByRole("textbox", { name: "Your WebID" }),
      screen.getByRole("button", { name: /Continue with Home pod/ }),
      screen.getByRole("button", { name: /Continue with Community/ }),
      screen.getByRole("button", { name: "Another provider" }),
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
    await user.click(screen.getByRole("button", { name: /Continue with Home pod/ }));
    await user.click(screen.getByRole("button", { name: /Continue as Alice/ }));
    await user.click(screen.getByRole("textbox", { name: "Your WebID" }));
    await user.keyboard("https://alice.example/me{Enter}");
    await user.click(screen.getByRole("button", { name: "What is a WebID?" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it("has no serious accessibility violations in the error and expanded states", async () => {
    render(
      <main>
        <SignInCard {...props({ recentAccounts: accounts, error: "Please try again." })} />
      </main>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Another provider" }));
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });
});
