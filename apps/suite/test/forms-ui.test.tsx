// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { AnswerForm } from "../src/apps/forms/components/answer-form";
import { Designer } from "../src/apps/forms/components/designer";
import { createMemoryFormsStore } from "../src/apps/forms/lib/data/memory-store";
import { newForm, newQuestion } from "../src/apps/forms/lib/designer";
import { createFakeRuntime } from "../src/apps/forms/lib/fake-runtime";
import { FormsProvider } from "../src/apps/forms/state/forms-context";
import type { PodSession } from "../src/lib/session/pod-session";

afterEach(cleanup);
describe("descriptor-driven answer controls", () => {
  it("keeps appended questions last when an imported form has gaps in sh:order", async () => {
    const root = "https://pod.example/";
    const session: PodSession = {
      mode: "demo",
      storageUrl: root,
      webId: `${root}profile#me`,
      displayName: "Demo",
      fetch: vi.fn(),
      subscribe: () => () => {},
      reset: async () => {},
    };
    const initial = {
      ...newForm(`${root}forms/order.ttl#form`),
      fields: [
        { ...newQuestion("first"), order: 0 },
        { ...newQuestion("second"), order: 5 },
      ],
    };
    const store = createMemoryFormsStore(root, { version: 1, forms: [initial], responses: [] });
    const saved = vi.fn();
    render(
      <FormsProvider session={session} store={store} unavailable={null}>
        <Designer initial={initial} onSaved={saved} onClose={() => {}} />
      </FormsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect((await store.loadForm(initial.shape)).fields.map((field) => field.order)).toEqual([
      0, 1, 2,
    ]);
  });
  it("designs, duplicates, reorders and saves a form through the store seam", async () => {
    const root = "https://pod.example/";
    const session: PodSession = {
      mode: "demo",
      storageUrl: root,
      webId: `${root}profile#me`,
      displayName: "Demo",
      fetch: vi.fn(),
      subscribe: () => () => {},
      reset: async () => {},
    };
    const store = createMemoryFormsStore(root, { version: 1, forms: [], responses: [] });
    const saved = vi.fn();
    const close = vi.fn();
    render(
      <FormsProvider session={session} store={store} unavailable={null}>
        <Designer
          initial={newForm(`${root}forms/picnic.ttl#form`)}
          onSaved={saved}
          onClose={close}
        />
      </FormsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));
    expect(screen.getByRole("alert").textContent).toContain("Add at least one question");
    fireEvent.change(screen.getByLabelText("Form title"), {
      target: { value: "A fictional picnic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.change(screen.getByLabelText("Question title"), {
      target: { value: "What will you bring?" },
    });
    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate question 1" }));
    const second = screen.getAllByLabelText("Question title")[1];
    if (!second) throw new Error("Missing duplicated control");
    fireEvent.change(second, { target: { value: "Your favourite picnic spot" } });
    fireEvent.click(screen.getByRole("button", { name: "Move question 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete question 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.change(screen.getByLabelText("Section 1"), { target: { value: "The afternoon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const model = (await store.listForms())[0];
    expect(model?.label).toBe("A fictional picnic");
    expect(model?.fields[0]?.label).toBe("Your favourite picnic spot");
    expect(model?.fields[0]?.minLength).toBe(2);
    expect(model?.groups[0]?.label).toBe("The afternoon");
    fireEvent.click(screen.getByRole("button", { name: "Back to forms" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("associates labels, exposes validation and keeps zero as an answer", () => {
    const form = {
      ...newForm("https://author.example/form#form"),
      fields: [
        { ...newQuestion("text"), label: "Your idea", minCount: 1 },
        { ...newQuestion("score", "decimal"), label: "Score", minCount: 1 },
      ],
    };
    const submit = vi.fn();
    render(<AnswerForm form={form} validate={createFakeRuntime().validate} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Save response to my pod" }));
    expect(screen.getByRole("alert").textContent).toContain("Review");
    const text = screen.getByLabelText("Your idea (required)");
    expect(text.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(text, { target: { value: "A reading corner" } });
    fireEvent.change(screen.getByLabelText("Score (required)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save response to my pod" }));
    expect(submit).toHaveBeenCalledWith({ q_text: "A reading corner", q_score: 0 });
  });
  it("normalises datetime-local minute precision to an XSD-compatible answer", () => {
    const form = {
      ...newForm("https://author.example/form#form"),
      fields: [{ ...newQuestion("time", "dateTime"), label: "When?", minCount: 1 }],
    };
    const submit = vi.fn();
    render(<AnswerForm form={form} validate={createFakeRuntime().validate} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("When? (required)"), {
      target: { value: "2026-11-11T12:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save response to my pod" }));
    expect(submit).toHaveBeenCalledWith({ q_time: "2026-11-11T12:30:00" });
  });
  it("renders sections and help text, and prevents unsupported nested submission", () => {
    const form = {
      ...newForm("https://author.example/form#form"),
      groups: [{ iri: "https://author.example/form#group", label: "More detail" }],
      fields: [
        {
          ...newQuestion("nested"),
          kind: "node" as const,
          group: "https://author.example/form#group",
          description: "Needs a nested control",
        },
      ],
    };
    render(<AnswerForm form={form} validate={createFakeRuntime().validate} />);
    expect(screen.getByRole("group", { name: "More detail" })).toBeTruthy();
    expect(screen.getByText("Needs a nested control")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save response to my pod" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("offers an honest empty preview", () => {
    render(
      <AnswerForm
        form={newForm("https://author.example/form#form")}
        validate={createFakeRuntime().validate}
        preview
      />,
    );
    expect(screen.getByText("Your questions will appear here")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Check preview answers" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/These answers won't be saved/)).toBeTruthy();
  });
});
