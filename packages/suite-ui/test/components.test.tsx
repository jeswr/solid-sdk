// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropZoneOverlay } from "../src/components/drop-zone-overlay.js";
import { PreviewPane, type PreviewSource, previewKind } from "../src/components/preview-pane.js";
import { type SurfaceState, surfaceErrorCopy } from "../src/components/surface-state.js";
import { UploadDock } from "../src/components/upload-dock.js";
import type { UploadItem } from "../src/uploads/queue.js";
import { uploadQueueReducer } from "../src/uploads/queue.js";

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
  it.each([
    "Pause",
    "Cancel",
  ])("moves focused %s to the next task's corresponding control after transport completion", (control) => {
    const uploading = item("uploading");
    const queued = item("queued");
    const { rerender } = render(
      <UploadDock {...controls} items={[uploading, item("done"), queued]} />,
    );
    screen.getByRole("button", { name: `${control} uploading.txt` }).focus();
    rerender(
      <UploadDock
        {...controls}
        items={[{ ...uploading, status: "done", sent: 100 }, item("done"), queued]}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `${control} queued.txt` }),
    );
  });

  it.each([
    "Pause",
    "Cancel",
  ])("returns focused %s to the dock toggle when transport completes the last task", (control) => {
    const uploading = item("uploading");
    const { rerender } = render(<UploadDock {...controls} items={[uploading]} />);
    screen.getByRole("button", { name: `${control} uploading.txt` }).focus();
    rerender(<UploadDock {...controls} items={[{ ...uploading, status: "done", sent: 100 }]} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Uploads.*Collapse/ }));
  });

  it("leaves focus outside the dock when an unfocused task completes", () => {
    const uploading = item("uploading");
    const view = (task: UploadItem) => (
      <>
        <button type="button">Folder action</button>
        <UploadDock {...controls} items={[task]} />
      </>
    );
    const { rerender } = render(view(uploading));
    screen.getByRole("button", { name: "Pause uploading.txt" }).focus();
    const outside = screen.getByRole("button", { name: "Folder action" });
    outside.focus();
    rerender(view({ ...uploading, status: "done", sent: 100 }));
    expect(document.activeElement).toBe(outside);
  });

  it("skips disabled pause controls when restoring focus after completion", () => {
    const paused = item("paused");
    const queued = item("queued");
    const { rerender } = render(
      <UploadDock {...controls} canPause={false} items={[paused, queued]} />,
    );
    screen.getByRole("button", { name: "Resume paused.txt" }).focus();
    rerender(
      <UploadDock {...controls} canPause={false} items={[{ ...paused, status: "done" }, queued]} />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Uploads.*Collapse/ }));
  });

  it("keeps keyboard focus through pause/resume/retry and returns it after cancel", () => {
    function Controlled() {
      const [items, dispatch] = useReducer(uploadQueueReducer, [item("uploading"), item("failed")]);
      return (
        <UploadDock
          items={items}
          onPause={(id) => dispatch({ type: "pause", id })}
          onResume={(id) => dispatch({ type: "resume", id })}
          onRetry={(id) => dispatch({ type: "retry", id })}
          onCancel={(id) => dispatch({ type: "cancel", id })}
        />
      );
    }
    render(<Controlled />);
    const pause = screen.getByRole("button", { name: "Pause uploading.txt" });
    pause.focus();
    fireEvent.click(pause);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Resume uploading.txt" }),
    );
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pause uploading.txt" }),
    );
    const retry = screen.getByRole("button", { name: "Retry failed.txt" });
    retry.focus();
    fireEvent.click(retry);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause failed.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel uploading.txt" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Uploads.*Collapse/ }));
  });

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
  for (const failure of ["read", "callback"] as const) {
    it.each([
      "Dismiss",
      "Escape",
    ])(`restores browsing with %s after a ${failure} failure and cancelled retry picker`, async (dismiss) => {
      const user = userEvent.setup();
      const onFiles = vi.fn().mockRejectedValue(new Error("callback failed"));
      const openFolder = vi.fn();
      render(
        <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
          <button type="button" onClick={openFolder}>
            Open folder
          </button>
        </DropZoneOverlay>,
      );
      const action = screen.getByRole("button", { name: "Open folder" });
      action.focus();
      const picker = screen.getByLabelText("Choose files");
      if (failure === "read") {
        fireEvent.drop(screen.getByRole("region"), {
          dataTransfer: {
            types: ["Files"],
            files: [],
            items: [
              {
                kind: "file",
                getAsFile: () => null,
                webkitGetAsEntry: () => ({
                  name: "one.txt",
                  isFile: true,
                  isDirectory: false,
                  file: (_success: (file: File) => void, reject: (error: DOMException) => void) =>
                    reject(new DOMException("read denied")),
                }),
              },
            ],
          },
        });
      } else {
        fireEvent.change(picker, { target: { files: [new File(["a"], "one.txt")] } });
      }
      const retry = await screen.findByRole("button", { name: "Choose files again" });
      expect(document.activeElement).toBe(retry);
      expect(action.closest("[inert]")).not.toBeNull();
      expect(onFiles).toHaveBeenCalledTimes(failure === "read" ? 0 : 1);
      for (const label of ["Choose files", "Choose folder"])
        expect(screen.getByLabelText(label).closest("[inert]")).toBeNull();
      const choose = vi.spyOn(picker, "click");
      await user.click(retry);
      expect(choose).toHaveBeenCalledOnce();
      fireEvent(picker, new Event("cancel", { bubbles: true }));
      if (dismiss === "Escape") await user.keyboard("{Escape}");
      else await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(action.closest("[inert]")).toBeNull();
      expect(document.activeElement).toBe(action);
      await user.keyboard("{Enter}");
      expect(openFolder).toHaveBeenCalledOnce();
    });
  }

  it.each([
    "success",
    "failure",
  ])("keeps outside focus when ingestion settles with %s", async (outcome) => {
    let settle = () => {};
    const pending = new Promise<void>((resolve, reject) => {
      settle = outcome === "success" ? resolve : () => reject(new Error("callback failed"));
    });
    render(
      <>
        <button type="button">Search</button>
        <DropZoneOverlay folderName="Projects" onFiles={() => pending}>
          <button type="button">Open folder</button>
        </DropZoneOverlay>
      </>,
    );
    screen.getByRole("button", { name: "Open folder" }).focus();
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["a"], "one.txt")] },
    });
    expect(document.activeElement).toBe(screen.getByRole("status", { name: "Loading" }));
    const outside = screen.getByRole("button", { name: "Search" });
    outside.focus();
    await act(async () => settle());
    expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("false");
    expect(Boolean(screen.queryByRole("alert"))).toBe(outcome === "failure");
    expect(document.activeElement).toBe(outside);
  });

  it("makes covered controls inert and focuses the loading status until ingestion finishes", async () => {
    const user = userEvent.setup();
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const openFolder = vi.fn();
    render(
      <DropZoneOverlay folderName="Projects" onFiles={() => pending}>
        <button type="button" onClick={openFolder}>
          Open folder
        </button>
      </DropZoneOverlay>,
    );
    const action = screen.getByRole("button", { name: "Open folder" });
    action.focus();
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["a"], "one.txt")] },
    });
    const loading = screen.getByRole("status", { name: "Loading" });
    expect(document.activeElement).toBe(loading);
    expect(loading.tabIndex).toBe(-1);
    expect(action.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Upload files" }).closest("[inert]")).not.toBeNull();
    await user.keyboard("{Enter}");
    expect(openFolder).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(action.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(action);
    await user.keyboard("{Enter}");
    expect(openFolder).toHaveBeenCalledOnce();
  });

  it("focuses retry after a rejected drop and restores the mounted folder action after retry", async () => {
    const user = userEvent.setup();
    const onFiles = vi
      .fn()
      .mockRejectedValueOnce(new Error("read denied"))
      .mockResolvedValue(undefined);
    const openFolder = vi.fn();
    render(
      <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
        <button type="button" onClick={openFolder}>
          Open folder
        </button>
      </DropZoneOverlay>,
    );
    const action = screen.getByRole("button", { name: "Open folder" });
    action.focus();
    const file = new File(["a"], "one.txt");
    fireEvent.drop(screen.getByRole("region"), {
      dataTransfer: {
        types: ["Files"],
        items: [{ kind: "file", getAsFile: () => file }],
        files: [file],
      },
    });
    const retry = await screen.findByRole("button", { name: "Choose files again" });
    expect(document.activeElement).toBe(retry);
    expect(action.closest("[inert]")).not.toBeNull();
    const picker = screen.getByLabelText("Choose files");
    const choose = vi.spyOn(picker, "click");
    await user.keyboard("{Enter}");
    expect(choose).toHaveBeenCalledOnce();
    expect(openFolder).not.toHaveBeenCalled();
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Open folder" })).toBe(action);
    expect(action.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(action);
  });

  it.each([
    "removed",
    "inert",
  ])("does not restore ingestion focus to a previously focused control that is now %s", async (change) => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onFiles = () => pending;
    const view = (showAction: boolean) => (
      <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
        {showAction && <button type="button">Open folder</button>}
      </DropZoneOverlay>
    );
    const { rerender } = render(view(true));
    const action = screen.getByRole("button", { name: "Open folder" });
    action.focus();
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["a"], "one.txt")] },
    });
    expect(document.activeElement).toBe(screen.getByRole("status", { name: "Loading" }));
    const focus = vi.spyOn(action, "focus");
    if (change === "removed") rerender(view(false));
    else action.setAttribute("inert", "");
    await act(async () => finish());
    expect(focus).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  });

  it("keeps children mounted after failed ingestion and while retrying", async () => {
    function Contents() {
      const [count, increment] = useReducer((value: number) => value + 1, 0);
      return (
        <button type="button" onClick={increment}>
          Selected {count}
        </button>
      );
    }
    const onFiles = vi
      .fn()
      .mockRejectedValueOnce(new Error("read denied"))
      .mockResolvedValue(undefined);
    const { container } = render(
      <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
        <Contents />
      </DropZoneOverlay>,
    );
    const selected = screen.getByRole("button", { name: "Selected 0" });
    fireEvent.click(selected);
    const choose = () =>
      fireEvent.change(screen.getByLabelText("Choose files"), {
        target: { files: [new File(["a"], "one.txt")] },
      });
    choose();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Selected 1" })).toBe(selected);
    await accessible(container);
    choose();
    expect(screen.getByRole("button", { name: "Selected 1" })).toBe(selected);
    await waitFor(() => expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("false"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Selected 1" })).toBe(selected);
  });

  it("clears nested drag state on leaving and handles escape outside the pane", () => {
    const { container } = render(
      <DropZoneOverlay folderName="Projects" onFiles={noop}>
        <p>Nested</p>
      </DropZoneOverlay>,
    );
    const zone = screen.getByRole("region");
    const transfer = { dataTransfer: { types: ["Files"] } };
    fireEvent.dragEnter(zone, transfer);
    fireEvent.dragEnter(screen.getByText("Nested"), transfer);
    fireEvent.dragLeave(screen.getByText("Nested"), { relatedTarget: zone });
    fireEvent.dragLeave(zone);
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(true);
    fireEvent.dragEnter(zone, transfer);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".su-drop-overlay")?.hasAttribute("hidden")).toBe(true);
  });
  it("reports synchronous entry-capture failures", async () => {
    render(<DropZoneOverlay folderName="Projects" onFiles={noop} />);
    fireEvent.drop(screen.getByRole("region"), {
      dataTransfer: {
        types: ["Files"],
        files: [],
        items: [
          {
            kind: "file",
            getAsFile: () => null,
            webkitGetAsEntry: () => {
              throw new Error("read denied");
            },
          },
        ],
      },
    });
    await screen.findByRole("alert");
  });

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
describe("DropZoneOverlay nested drop targets", () => {
  it("leaves a drop claimed by a descendant to that descendant", async () => {
    const onFiles = vi.fn();
    const onCrumbDrop = vi.fn((event: React.DragEvent) => event.preventDefault());
    render(
      <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
        <button type="button" onDrop={onCrumbDrop}>
          Parent
        </button>
      </DropZoneOverlay>,
    );
    const file = new File(["a"], "one.txt");
    fireEvent.drop(screen.getByRole("button", { name: "Parent" }), {
      dataTransfer: {
        types: ["Files"],
        items: [{ kind: "file", getAsFile: () => file }],
        files: [file],
      },
    });
    expect(onCrumbDrop).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
describe("PreviewPane", () => {
  it("forces PDF MIME on the iframe blob rather than embedding HTML", async () => {
    render(
      <PreviewPane
        source={{
          ...source("text/html", "<script>bad()</script>"),
          contentType: "application/pdf",
        }}
      />,
    );
    await screen.findByTitle("PDF preview: Example");
    expect(vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]).toHaveProperty(
      "type",
      "application/pdf",
    );
  });
  it("pans an image with pointer capture", async () => {
    render(<PreviewPane source={source("image/png")} />);
    const viewport = await screen.findByRole("region", { name: "Image preview: Example" });
    viewport.setPointerCapture = vi.fn();
    viewport.scrollLeft = 100;
    viewport.scrollTop = 100;
    fireEvent(
      viewport,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 40, clientY: 40 }),
    );
    fireEvent(viewport, new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 20 }));
    expect(viewport.scrollLeft).toBe(130);
    expect(viewport.scrollTop).toBe(120);
    fireEvent.pointerUp(viewport);
    fireEvent(viewport, new MouseEvent("pointermove", { bubbles: true, clientX: 0, clientY: 0 }));
    expect(viewport.scrollLeft).toBe(130);
  });

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

it.each([
  "text/n3",
  "application/n-quads",
  "text/turtle",
  "application/ld+json",
  "application/n-triples",
  "application/trig",
  "application/rdf+xml",
])("routes %s to typed content or the download fallback without reading raw data", async (type) => {
  const data = source(type, "Private raw data");
  const read = vi.spyOn(data.blob, "text");
  const { container, rerender } = render(
    <PreviewPane
      source={{
        ...data,
        contentType: `${type.toUpperCase()}; charset=utf-8`,
        typedView: <p>Readable typed content</p>,
      }}
    />,
  );
  await screen.findByText("Readable typed content");
  expect(previewKind(type)).toBe("typed");
  expect(container.textContent).not.toContain("Private raw data");
  rerender(<PreviewPane source={data} />);
  await screen.findByText("Can't preview this file");
  expect(screen.getByRole("link", { name: "Download Example" })).toBeTruthy();
  expect(container.querySelector("pre")).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each([
  "text/plain",
  "text/markdown",
])("bounds %s previews at 1 MiB before reading", async (type) => {
  const blob = new NodeBlob([new Uint8Array(1024 * 1024 + 1)], { type }) as Blob;
  const read = vi.spyOn(blob, "text").mockResolvedValue("Must not be read");
  render(<PreviewPane source={{ name: "Large", blob }} />);
  await screen.findByText("Too large to preview");
  expect(screen.getByRole("link", { name: "Download Large" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show raw" })).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each(["text/plain", "text/markdown"])("allows %s previews of exactly 1 MiB", async (type) => {
  const blob = new NodeBlob([new Uint8Array(1024 * 1024)], { type }) as Blob;
  const read = vi.spyOn(blob, "text").mockResolvedValue("Allowed text");
  render(<PreviewPane source={{ name: "Boundary", blob }} />);
  await screen.findByText("Allowed text");
  expect(screen.getByRole("link", { name: "Download Boundary" })).toBeTruthy();
  expect(read).toHaveBeenCalledOnce();
});
