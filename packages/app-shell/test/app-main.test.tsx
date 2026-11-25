// AUTHORED-BY Claude Sonnet 5.5
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppMain } from "../src/index.js";

describe("AppMain", () => {
  it("shows the loading content inside .app-loading while the value is missing", () => {
    const { container } = render(
      <AppMain value={null} loading={<span>Finding it…</span>}>
        {(v: string) => <p>{v}</p>}
      </AppMain>,
    );
    expect(container.querySelector("main.app-main > p.app-loading")).toHaveTextContent(
      "Finding it…",
    );
  });

  it("renders the notice as a sibling before <main>", () => {
    const { container } = render(
      <AppMain value="ready" loading={null} notice={<p className="app-note">careful</p>}>
        {(v) => <section>{v}</section>}
      </AppMain>,
    );
    expect(container.children[0]).toHaveClass("app-note");
    expect(container.children[1]?.tagName).toBe("MAIN");
  });

  it("renders the view with the resolved value", () => {
    const { container } = render(
      <AppMain value="ready" loading={<span>Finding it…</span>}>
        {(v) => <section>{v}</section>}
      </AppMain>,
    );
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(container.querySelector(".app-loading")).toBeNull();
    expect(container.querySelector("main.app-main > section")).not.toBeNull();
  });
});
