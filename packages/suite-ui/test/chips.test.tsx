// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import type { ChipRef, ResolvedChip } from "@jeswr/suite-sdk/chips/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Chip, ChipEditorTools, ChipPicker, ChipText, ChipTextarea } from "../src/chips.js";

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
    render(<Chip resolveOnMount reference={bob} resolve={resolve} href="/contacts" />);
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
        resolveOnMount
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
    const view = render(<Chip resolveOnMount reference={bob} resolve={resolve} />);
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
    expect(close.mock.calls).toEqual([[true], [false]]);
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

describe("chip composer controls", () => {
  it("defers foreign metadata until focus or hover and never resolves unsafe refs", async () => {
    const resolve = vi.fn(async () => ({
      ...bob,
      label: "Robert",
      icon: "person" as const,
      readable: true,
    }));
    const view = render(<Chip reference={bob} resolve={resolve} />);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByRole("link", { name: "Bob" }));
    await screen.findByRole("link", { name: "Robert" });
    expect(resolve).toHaveBeenCalledTimes(1);
    view.rerender(
      <Chip reference={{ ...bob, iri: "javascript:bad" }} resolve={resolve} resolveOnMount />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<Chip reference={file} resolve={resolve} />);
    fireEvent.pointerEnter(screen.getByRole("link", { name: "File" }), { pointerType: "mouse" });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });
  it("forwards blur saves, keeps a dismissed @ closed, and leaves focus on an outside control", async () => {
    const blur = vi.fn();
    function Field() {
      const [value, setValue] = useState("");
      return (
        <>
          <ChipTextarea
            aria-label="Description"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={blur}
            search={async () => [bob]}
          />
          <button type="button">Other field</button>
        </>
      );
    }
    render(<Field />);
    const field = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(field, { target: { value: "@", selectionStart: 1 } });
    let combo = await screen.findByRole("combobox");
    fireEvent.blur(field, { relatedTarget: combo });
    expect(blur).toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "@B", selectionStart: 2 } });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.change(field, { target: { value: "", selectionStart: 0 } });
    fireEvent.change(field, { target: { value: "@", selectionStart: 1 } });
    combo = await screen.findByRole("combobox");
    const other = screen.getByRole("button", { name: "Other field" });
    act(() => other.focus());
    fireEvent.blur(combo, { relatedTarget: other });
    expect(document.activeElement).toBe(other);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("preserves controlled changes when choosing a chip and does not refocus on Tab", async () => {
    function Field() {
      const [value, setValue] = useState("");
      return (
        <ChipTextarea
          aria-label="Message"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          search={async () => [bob]}
        />
      );
    }
    render(<Field />);
    const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hi @", selectionStart: 4 } });
    const option = await screen.findByRole("option");
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(field.value).toBe(`Hi @[Bob](${bob.iri} "chip:person") `);
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "@", selectionStart: 1 } });
    const focus = vi.spyOn(field, "focus");
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Tab" });
    expect(focus).not.toHaveBeenCalled();
  });
  it("shares rich editor dismissal, insertion and focus handling through a small adapter", async () => {
    let listener = () => {};
    let query: { from: number; to: number; query: string } | null = { from: 1, to: 2, query: "" };
    const unsubscribe = vi.fn();
    const editor = {
      query: () => query,
      subscribe: (fn: () => void) => {
        listener = fn;
        return unsubscribe;
      },
      focus: vi.fn(),
      insert: vi.fn(),
    };
    const view = render(<ChipEditorTools editor={editor} search={async () => [bob]} />);
    act(listener);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Escape" });
    expect(editor.focus).toHaveBeenCalledTimes(1);
    act(listener);
    expect(screen.queryByRole("combobox")).toBeNull();
    query = null;
    act(listener);
    query = { from: 1, to: 2, query: "" };
    act(listener);
    fireEvent.click(await screen.findByRole("option"));
    expect(editor.insert).toHaveBeenCalledWith(query, bob);
    act(listener);
    const other = document.createElement("button");
    document.body.append(other);
    const combo = await screen.findByRole("combobox");
    act(() => other.focus());
    fireEvent.blur(combo, { relatedTarget: other });
    expect(editor.focus).toHaveBeenCalledTimes(1);
    other.remove();
    view.rerender(<ChipEditorTools editor={null} search={async () => []} />);
    expect(unsubscribe).toHaveBeenCalled();
  });
});

it("renders structured text through the default chip and optional application adapters", () => {
  const text = `Before @[Bob](${bob.iri} "chip:person") after`;
  const view = render(<ChipText text={text} />);
  expect(screen.getByRole("link", { name: "Bob" }).getAttribute("href")).toBe(bob.iri);
  expect(view.container.textContent).toBe("Before Bob after");
  view.rerender(
    <ChipText
      text={text}
      plain={(value) => <em>{value}</em>}
      renderChip={(ref) => <strong>{ref.label}</strong>}
    />,
  );
  expect(view.container.querySelector("strong")?.textContent).toBe("Bob");
  expect(view.container.querySelector("em")?.textContent).toBe("Before ");
});
