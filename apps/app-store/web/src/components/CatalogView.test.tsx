// AUTHORED-BY Codex GPT-6
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogView } from "./CatalogView";

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

it.each([
  "/",
  "./",
  "/solid-sdk/app-store/",
])("resolves download links from a nested catalog route with base %s", (base) => {
  vi.stubEnv("BASE_URL", base);
  history.replaceState(null, "", "/solid-sdk/app-store/catalog/");
  render(<CatalogView apps={[]} />);
  const root = new URL(base, `${location.origin}/`);
  expect(screen.getByRole("link", { name: "Turtle" })).toHaveAttribute(
    "href",
    new URL("catalog.ttl", root).href,
  );
  expect(screen.getByRole("link", { name: "JSON-LD" })).toHaveAttribute(
    "href",
    new URL("catalog.jsonld", root).href,
  );
});
