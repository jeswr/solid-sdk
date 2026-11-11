// AUTHORED-BY Codex GPT-6
import { screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { afterEach, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { suiteDiaryUrl } from "@/lib/suite-url";
import { renderWithSession } from "../../test/session-harness";
import { AppChrome } from "./app-chrome";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: () => "/log" }));
vi.mock("@jeswr/app-shell", () => ({
  AccountMenu: () => null,
  FeedbackButton: () => null,
  ThemeToggle: () => null,
}));
afterEach(() => vi.unstubAllEnvs());

it("uses the shared Health diary URL for the home redirect and both navigation links", () => {
  Home();
  expect(redirect).toHaveBeenCalledWith(suiteDiaryUrl());
  renderWithSession(
    <AppChrome>
      <p>Log a meal</p>
    </AppChrome>,
  );
  const links = screen.getAllByRole("link", { name: "Open in Health" });
  expect(links).toHaveLength(2);
  for (const link of links) expect(link).toHaveAttribute("href", suiteDiaryUrl());
  expect(screen.getByRole("link", { name: "Log food" })).toHaveAttribute("href", "/log");
  expect(screen.getByRole("link", { name: "Log food" })).toHaveAttribute("aria-current", "page");
});

it("honours a configured suite URL with or without a trailing slash", () => {
  for (const base of ["https://suite.example", "https://suite.example/"]) {
    vi.stubEnv("NEXT_PUBLIC_SUITE_URL", base);
    expect(suiteDiaryUrl()).toBe("https://suite.example/health/diary?mode=coeliac");
  }
});
