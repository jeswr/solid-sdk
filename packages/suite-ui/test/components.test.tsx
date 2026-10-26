// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropZoneOverlay } from "../src/components/drop-zone-overlay.js";
import { PreviewPane, type PreviewSource, previewKind } from "../src/components/preview-pane.js";
import { type SurfaceState, surfaceErrorCopy } from "../src/components/surface-state.js";
import { UploadDock } from "../src/components/upload-dock.js";
import type { UploadItem } from "../src/uploads/queue.js";

const noop = () => {};
const controls = { onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn() };
const item = (status: UploadItem["status"]): UploadItem => ({
  id: status,
  name: `${status}.txt`,
  status,
  sent: status === "done" ? 100 : 25,
  total: 100,
  attempt: 1,
});
const source = (type: string, content = "Hello"): PreviewSource => ({
  name: "Example",
  blob: new NodeBlob([content], { type }) as Blob,
});
async function accessible(container: HTMLElement) {
  const result = await axe.run(container, {
    iframes: false,
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let sequence = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:fixture-${++sequence}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("UploadDock", () => {
  it("shows per-file progress, labelled actions, live summary and a keyboard-collapsible pill", async () => {
    const { container } = render(
      <UploadDock
        {...controls}
        items={["queued", "uploading", "paused", "waiting", "done", "failed", "skipped"].map(
          (status) => item(status as UploadItem["status"]),
        )}
      />,
    );
    expect(
      screen
        .getByRole("progressbar", { name: "Upload uploading.txt" })
        .getAttribute("aria-valuenow"),
    ).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Pause uploading.txt" }));
    expect(controls.onPause).toHaveBeenCalledWith("uploading");
    fireEvent.click(screen.getByRole("button", { name: "Resume paused.txt" }));
    expect(controls.onResume).toHaveBeenCalledWith("paused");
    fireEvent.click(screen.getByRole("button", { name: "Retry failed.txt" }));
    expect(controls.onRetry).toHaveBeenCalledWith("failed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel queued.txt" }));
    expect(controls.onCancel).toHaveBeenCalledWith("queued");
    expect(screen.getByRole("status").textContent).toContain("1 waiting");
    await accessible(container);
    fireEvent.keyDown(screen.getByRole("button", { name: "Resume paused.txt" }), { key: "Escape" });
    const toggle = screen.getByRole("button", { name: /7 uploads.*Expand/ });
    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole("progressbar")).toBeNull();
    await accessible(container);
    fireEvent.click(toggle);
    expect(screen.getAllByRole("progressbar")).toHaveLength(7);
  });
  it("explains unavailable pause, handles zero bytes and long names", async () => {
    const { container } = render(
      <UploadDock
        {...controls}
        canPause={false}
        items={[
          { ...item("uploading"), total: 0, sent: 0, name: "a".repeat(200) },
          { ...item("done"), total: 0 },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /^Pause/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Pausing is not available on this storage")).toBeTruthy();
    expect(
      screen.getAllByRole("progressbar").map((el) => el.getAttribute("aria-valuenow")),
    ).toEqual(["0", "100"]);
    await accessible(container);
  });
});
describe("async feedback", () => {
  const states: SurfaceState[] = [
    { status: "loading" },
    { status: "empty" },
    { status: "filtered-empty", query: "travel" },
    ...Object.keys(surfaceErrorCopy).map((error) => ({
      status: "error" as const,
      error: error as keyof typeof surfaceErrorCopy,
    })),
  ];
  for (const state of states)
    for (const component of ["dock", "drop", "preview"]) {
      it(`${component} ${JSON.stringify(state)} is accessible`, async () => {
        const action = vi.fn();
        const element =
          component === "dock" ? (
            <UploadDock {...controls} items={[]} state={state} onAction={action} />
          ) : component === "drop" ? (
            <DropZoneOverlay folderName="Projects" state={state} onFiles={noop} onAction={action} />
          ) : (
            <PreviewPane state={state} onAction={action} />
          );
        const { container } = render(element);
        await accessible(container);
        if (state.status !== "loading") {
          const buttons = screen.getAllByRole("button");
          fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
          expect(action).toHaveBeenCalled();
        }
      });
    }
});
describe("DropZoneOverlay", () => {
  it("keeps nested drag events stable, ignores non-file drags and clears on escape/leave", async () => {
    const { container } = render(
      <DropZoneOverlay folderName="Projects" onFiles={noop}>
        <p>Folder content</p>
      </DropZoneOverlay>,
    );
    const zone = screen.getByRole("region");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["text/plain"] } });
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(true);
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragEnter(screen.getByText("Folder content"), { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(screen.getByText("Folder content"), { relatedTarget: zone });
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(false);
    await accessible(container);
    fireEvent.keyDown(zone, { key: "Escape" });
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(true);
    fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(zone);
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(true);
  });
  it("offers keyboard pickers and reports typed read failures", async () => {
    const onFiles = vi.fn().mockRejectedValue(new Error("private detail"));
    const { container } = render(<DropZoneOverlay folderName="Projects" onFiles={onFiles} />);
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["a"], "one.txt")] },
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Can't read these files");
    expect(container.textContent).not.toContain("private detail");
    await accessible(container);
  });
  it("reads native file drops and ignores duplicate drops during a pending callback", async () => {
    let finish: (() => void) | undefined;
    const onFiles = vi.fn(
      (_files: unknown) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<DropZoneOverlay folderName="Projects" onFiles={onFiles} />);
    const zone = screen.getByRole("region");
    const file = new File(["a"], "one.txt");
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => file }],
      files: [file],
    };
    fireEvent.drop(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(onFiles.mock.calls[0]?.[0]).toMatchObject({ files: [{ path: "one.txt" }] });
    finish?.();
    await waitFor(() => expect(zone.getAttribute("aria-busy")).toBe("false"));
  });
});
describe("PreviewPane", () => {
  it.each([
    ["image/png", "image"],
    ["application/pdf", "pdf"],
    ["video/mp4", "video"],
    ["audio/wav", "audio"],
    ["text/plain", "text"],
    ["TEXT/MARKDOWN; charset=utf-8", "markdown"],
    ["text/turtle", "typed"],
    ["application/ld+json", "typed"],
    ["application/octet-stream", "unknown"],
  ])("dispatches %s to %s", (type, kind) => {
    expect(previewKind(type as string)).toBe(kind);
  });
  it("zooms and pans via keyboard, resets, respects browser shortcuts and handles errors", async () => {
    const { container } = render(<PreviewPane source={source("image/png")} />);
    const viewport = await screen.findByRole("region", { name: "Image preview: Example" });
    fireEvent.keyDown(viewport, { key: "+" });
    expect(screen.getByText("125%")).toBeTruthy();
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(viewport.scrollLeft).toBe(40);
    fireEvent.keyDown(viewport, { key: "+", ctrlKey: true });
    expect(screen.getByText("125%")).toBeTruthy();
    fireEvent.keyDown(viewport, { key: "-" });
    expect(screen.getByText("100%")).toBeTruthy();
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("400%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("100%")).toBeTruthy();
    await accessible(container);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert").textContent).toBe("Can't preview this file");
    expect(screen.getByRole("link", { name: "Download Example" })).toBeTruthy();
  });
  it("renders markdown safely, toggles raw text, blocks remote images and script links", async () => {
    const { container } = render(
      <PreviewPane
        source={source(
          "text/markdown",
          "# Notes\n\n**Ready**\n\n<script>bad()</script>\n\n[bad](javascript:alert(1))\n\n![private](https://example.org/tracker.png)",
        )}
      />,
    );
    await screen.findByRole("heading", { name: "Notes" });
    expect(container.querySelector("strong")?.textContent).toBe("Ready");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show raw" }));
    expect(container.querySelector("pre")?.textContent).toContain("**Ready**");
    fireEvent.click(screen.getByRole("button", { name: "Show rendered" }));
    await accessible(container);
  });
  it.each([
    "text/plain",
    "application/pdf",
    "audio/wav",
    "video/mp4",
    "application/octet-stream",
    "text/turtle",
  ])("renders %s and a download fallback", async (type) => {
    const { container } = render(<PreviewPane source={source(type, "Plain text")} />);
    await screen.findByRole("link", { name: "Download Example" });
    if (type === "text/plain") await screen.findByText("Plain text");
    if (type === "application/pdf")
      expect(screen.getByTitle("PDF preview: Example").tagName).toBe("IFRAME");
    if (type === "audio/wav" || type === "video/mp4")
      expect(container.querySelector("audio, video")?.hasAttribute("controls")).toBe(true);
    if (type === "text/turtle") expect(container.textContent).not.toContain("Plain text");
    await accessible(container);
  });
  it("delegates typed data, revokes object URLs, and resets when a same-name blob changes", async () => {
    const first = source("text/turtle");
    first.typedView = <p>Contact: Alex</p>;
    const { rerender, unmount } = render(<PreviewPane source={first} />);
    await screen.findByText("Contact: Alex");
    rerender(<PreviewPane source={source("text/plain", "Other")} />);
    await screen.findByText("Other");
    expect(screen.queryByText("Contact: Alex")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-1");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-2");
  });
  it("clears text from a previous same-name file and handles rejected reads", async () => {
    const { rerender } = render(<PreviewPane source={source("text/plain", "First")} />);
    await screen.findByText("First");
    rerender(<PreviewPane source={source("text/plain", "Later")} />);
    await screen.findByText("Later");
    expect(screen.queryByText("First")).toBeNull();
    const bad = source("text/plain");
    vi.spyOn(bad.blob, "text").mockRejectedValue(new Error("read failed"));
    rerender(<PreviewPane source={bad} />);
    await screen.findByRole("alert");
  });
});
