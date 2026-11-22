// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { toast } from "@jeswr/suite-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { FillView } from "../src/apps/forms/components/fill-view";
import { FormsHome } from "../src/apps/forms/components/forms-home";
import { ResponsesView } from "../src/apps/forms/components/responses-view";
import { sampleForms } from "../src/apps/forms/demo/sample";
import { createMemoryFormsStore } from "../src/apps/forms/lib/data/memory-store";
import { ResponseSaveUncertainError } from "../src/apps/forms/lib/data/store";
import { FormsProvider, useForms } from "../src/apps/forms/state/forms-context";
import { saveBlob } from "../src/lib/native/save-file";
import type { PodSession } from "../src/lib/session/pod-session";

const query = vi.hoisted(() => ({ shape: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ form: query.shape }),
}));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("../src/lib/native/save-file", () => ({ saveBlob: vi.fn() }));
const root = "https://pod.example/";
const sample = sampleForms(root);
const form = sample.forms[0];
if (!form) throw new Error("Missing fixture");
const session: PodSession = {
  mode: "demo",
  storageUrl: root,
  webId: `${root}profile#me`,
  displayName: "Demo",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: async () => {},
};
const makeStore = () => createMemoryFormsStore(root, sample);
function show(children: React.ReactNode, store = makeStore()) {
  return render(
    <FormsProvider session={session} store={store} unavailable={null}>
      {children}
    </FormsProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("response view", () => {
  it("renders the table and details without stray punctuation, and closes", async () => {
    const close = vi.fn();
    const view = show(<ResponsesView form={form} close={close} />);
    expect(screen.getByLabelText("Loading responses…")).toBeTruthy();
    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("2 responses");
    expect(view.container.textContent).not.toMatch(/;\s*$/);
    fireEvent.click(screen.getByRole("button", { name: "Response 1" }));
    expect(screen.getByRole("dialog").textContent).toContain(sample.responses[0]?.subject);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Back to forms" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("shows read failures, retries and an empty collection", async () => {
    const store = makeStore();
    vi.spyOn(store, "listResponses")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([]);
    show(<ResponsesView form={form} close={() => {}} />, store);
    await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No received responses yet");
    expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("passes CSV to the shared saver and reports export errors", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
    vi.mocked(saveBlob).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("disk"));
    const error = vi.spyOn(toast, "error");
    show(<ResponsesView form={form} close={() => {}} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "form-responses.csv", "text/csv"),
    );
    expect(error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't export your responses. Try again."),
    );
  });
});

describe("fill URL boundary and source notice", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/plain,hi",
    "http://192.168.1.2/form",
    "https://me:secret@evil.example/form",
    "/form",
    "#form",
    "//evil.example/form",
    `https://evil.example/${"x".repeat(4096)}`,
  ])("refuses %s without invoking the store", (shape) => {
    query.shape = shape;
    const store = makeStore();
    const load = vi.spyOn(store, "loadForm");
    show(<FillView />, store);
    expect(screen.getByText("This form address isn't safe to open")).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });
  it("shows the foreign origin before people can fill a form", async () => {
    query.shape = "https://author.example/forms/a#form";
    const store = makeStore();
    vi.spyOn(store, "loadForm").mockResolvedValue({ ...form, shape: query.shape });
    show(<FillView />, store);
    await screen.findByText(/This form is hosted at https:\/\/author.example/);
    expect(screen.getByRole("button", { name: "Save response to my pod" })).toBeTruthy();
  });
  it.each([
    false,
    true,
  ])("uses the store's foreign-origin decision (%s), even when the session differs", async (foreign) => {
    query.shape = form.shape;
    const store = makeStore();
    const decision = vi.spyOn(store, "isForeign").mockReturnValue(foreign);
    show(<FillView />, store);
    await screen.findByRole("button", { name: "Save response to my pod" });
    expect(decision).toHaveBeenCalledWith(form.shape);
    expect(!!screen.queryByText(/opened without your pod credentials/)).toBe(foreign);
  });
  it.each([
    false,
    true,
  ])("preserves answers and shows respondent-specific failure copy (uncertain: %s)", async (uncertain) => {
    query.shape = form.shape;
    const store = makeStore();
    const question = form.fields[0];
    if (!question) throw new Error("Missing name question");
    const model = { ...form, fields: [question] };
    vi.spyOn(store, "loadForm").mockResolvedValue(model);
    vi.spyOn(store, "submit").mockRejectedValue(
      uncertain ? new ResponseSaveUncertainError() : new Error("Reload this form before editing"),
    );
    const error = vi.spyOn(toast, "error");
    show(<FillView />, store);
    const input = await screen.findByLabelText(/Your name/);
    fireEvent.change(input, { target: { value: "Ember Vale" } });
    fireEvent.click(screen.getByRole("button", { name: "Save response to my pod" }));
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain(
      uncertain ? "Your response may already be saved" : "Couldn't save your response",
    );
    expect(notice.textContent).not.toContain("Reload this form before editing");
    expect(error).toHaveBeenCalledWith(notice.textContent);
    expect((input as HTMLInputElement).value).toBe("Ember Vale");
    expect(store.submit).toHaveBeenCalledOnce();
  });
});

describe("forms home", () => {
  it("keeps the last forms visible after a refresh failure and offers a working retry", async () => {
    const store = makeStore();
    const list = vi.spyOn(store, "listForms");
    function Reload() {
      const { controller } = useForms();
      return (
        <button type="button" onClick={() => void controller.load()}>
          Reload
        </button>
      );
    }
    show(
      <>
        <Reload />
        <FormsHome />
      </>,
      store,
    );
    await screen.findByRole("button", { name: `Design form: ${form.label}` });
    list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByText("Couldn't refresh your forms. Showing the last saved list.");
    expect(screen.getByRole("button", { name: `Design form: ${form.label}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try refreshing again" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh/)).toBeNull());
    await screen.findByRole("button", { name: `Design form: ${form.label}` });
    expect(list).toHaveBeenCalledTimes(3);
  });
  it("reports skipped resources quietly and retains visible design text in the accessible name", async () => {
    const store = makeStore();
    vi.spyOn(store, "listForms").mockResolvedValue({
      forms: sample.forms,
      skipped: ["https://pod.example/empty"],
    });
    show(<FormsHome />, store);
    await screen.findByText("1 resources couldn't be opened as forms and were skipped.");
    expect(screen.getByRole("button", { name: `Design form: ${form.label}` }).textContent).toBe(
      "Design form",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
