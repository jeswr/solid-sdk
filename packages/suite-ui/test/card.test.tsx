// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it } from "vitest";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../src/index.js";

afterEach(cleanup);

function slot(name: string) {
  const element = document.querySelector(`[data-slot="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${name}`);
  return element;
}

it("renders every Card part with its data-slot and the default size", async () => {
  const { container } = render(
    <main>
      <Card aria-labelledby="card-title">
        <CardHeader>
          <CardTitle id="card-title">Storage</CardTitle>
          <CardDescription>2 GB used</CardDescription>
          <CardAction>
            <button type="button">Manage</button>
          </CardAction>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    </main>,
  );
  for (const name of [
    "card",
    "card-header",
    "card-title",
    "card-description",
    "card-action",
    "card-content",
    "card-footer",
  ]) {
    expect(slot(name)).toBeDefined();
  }
  expect(slot("card").dataset.size).toBe("default");
  expect(screen.getByText("Storage").id).toBe("card-title");
  expect(screen.getByRole("button", { name: "Manage" }).closest("[data-slot=card-action]")).toBe(
    slot("card-action"),
  );
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
});

it("uses suite tokens rather than app colours, and merges consumer classes", () => {
  render(
    <Card size="sm" className="consumer-card p-0">
      <CardFooter className="justify-end">Footer</CardFooter>
    </Card>,
  );
  const card = slot("card");
  expect(card.dataset.size).toBe("sm");
  expect(card.className).toContain("bg-card");
  expect(card.className).toContain("text-card-foreground");
  expect(card.className).toContain("ring-border");
  expect(card.className).toContain("consumer-card");
  // tailwind-merge drops the conflicting default vertical padding for the consumer's p-0.
  expect(card.className).toContain("p-0");
  expect(card.className).not.toMatch(/(^|\s)py-/);
  expect(card.className).not.toMatch(/oklch|#[0-9a-f]{3,6}\b/i);
  const footer = slot("card-footer");
  expect(footer.className).toContain("bg-muted");
  expect(footer.className).toContain("justify-end");
});

it("forwards native div props to each part", () => {
  render(
    <Card id="outer" role="region" aria-label="Usage">
      <CardHeader data-testid="header" />
      <CardContent hidden>Hidden content</CardContent>
    </Card>,
  );
  expect(screen.getByRole("region", { name: "Usage" }).id).toBe("outer");
  expect(screen.getByTestId("header").dataset.slot).toBe("card-header");
  expect(slot("card-content").hidden).toBe(true);
});
