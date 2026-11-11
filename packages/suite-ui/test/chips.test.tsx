// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import type { ChipRef, ResolvedChip } from "@jeswr/suite-sdk/chips";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip, ChipPicker } from "../src/chips.js";

const bob: ChipRef = { iri: "https://bob.example/#me", label: "Bob", kind: "person" };
const file: ChipRef = { iri: "https://pod.example/file", label: "File", kind: "file" };

describe("Chip", () => {
  it("renders the stored label, resolves a live title and exposes a card on focus", async () => {
    const resolve = vi.fn(
      async (): Promise<ResolvedChip> => ({
        ...bob,
        label: "Robert",
        icon: "person",
        readable: true,
        owner: "https://owner.example/#me",
      }),
    );
    render(<Chip reference={bob} resolve={resolve} href="/contacts" />);
    const anchor = await screen.findByRole("link", { name: "Robert" });
    expect(anchor.getAttribute("href")).toBe("/contacts");
    fireEvent.focus(anchor);
    expect(await screen.findByRole("link", { name: "Open Robert" })).toBeTruthy();
    expect(screen.getByText("Owner: https://owner.example/#me")).toBeTruthy();
    fireEvent.keyDown(anchor, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Open Robert" })).toBeNull());
  });
  it("uses the original IRI and a lock when metadata is unavailable", async () => {
    render(
      <Chip
        reference={bob}
        href="/contacts"
        resolve={async () => {
          throw new Error("denied");
        }}
      />,
    );
    const anchor = screen.getByRole("link", { name: "Bob" });
    await waitFor(() => expect(anchor.getAttribute("href")).toBe(bob.iri));
    fireEvent.focus(anchor);
    expect(await screen.findByText("Private or unavailable")).toBeTruthy();
    expect(anchor.querySelector("svg.lucide-lock")).toBeTruthy();
  });
  it("fences stale resolutions and refuses unsafe links", async () => {
    let finish!: (value: ResolvedChip) => void;
    const resolve = () =>
      new Promise<ResolvedChip>((done) => {
        finish = done;
      });
    const view = render(<Chip reference={bob} resolve={resolve} />);
    view.rerender(<Chip reference={file} />);
    await act(async () => finish({ ...bob, label: "Stale", icon: "person", readable: true }));
    expect(screen.queryByText("Stale")).toBeNull();
    view.rerender(<Chip reference={{ ...bob, iri: "javascript:bad" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("ChipPicker", () => {
  it("debounces search and supports arrows, selection, Escape and Tab", async () => {
    const search = vi.fn(async () => [bob, file]);
    const choose = vi.fn();
    const close = vi.fn();
    render(<ChipPicker search={search} onChoose={choose} onClose={close} />);
    const combo = screen.getByRole("combobox");
    expect(document.activeElement).toBe(combo);
    await screen.findByRole("option", { name: "Bob (person)" });
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "File (file)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "ArrowUp" });
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(choose).toHaveBeenCalledWith(file);
    fireEvent.keyDown(combo, { key: "Escape" });
    fireEvent.keyDown(combo, { key: "Tab" });
    expect(close).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(combo, { key: "Enter", isComposing: true });
    expect(choose).toHaveBeenCalledTimes(1);
  });
  it("ignores stale success and failure, exposes no matches and search errors", async () => {
    const pending: {
      query: string;
      signal: AbortSignal;
      resolve: (refs: ChipRef[]) => void;
      reject: () => void;
    }[] = [];
    const search = (query: string, signal: AbortSignal) =>
      new Promise<ChipRef[]>((resolve, reject) =>
        pending.push({ query, signal, resolve, reject: () => reject(new Error("failed")) }),
      );
    render(<ChipPicker search={search} onChoose={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    const combo = screen.getByRole("combobox");
    fireEvent.change(combo, { target: { value: "new" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]?.signal.aborted).toBe(true);
    await act(async () => pending[0]?.resolve([bob]));
    expect(screen.queryByRole("option")).toBeNull();
    await act(async () => pending[1]?.resolve([]));
    expect(screen.getByText("No matches")).toBeTruthy();
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "Enter" });
    fireEvent.change(combo, { target: { value: "fail" } });
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => pending[2]?.reject());
    expect(screen.getByText("Couldn't search. Try again.")).toBeTruthy();
  });
  it("supports pointer selection and closes on focus leaving the picker", async () => {
    const choose = vi.fn();
    const close = vi.fn();
    render(<ChipPicker search={async () => [bob]} onChoose={choose} onClose={close} />);
    const option = await screen.findByRole("option");
    fireEvent.mouseMove(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(choose).toHaveBeenCalledWith(bob);
    fireEvent.blur(screen.getByRole("combobox"), { relatedTarget: document.body });
    expect(close).toHaveBeenCalled();
  });
});
