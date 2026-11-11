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
import { FormsProvider } from "../src/apps/forms/state/forms-context";
import { saveNatively } from "../src/lib/native/save-file";
import type { PodSession } from "../src/lib/session/pod-session";

const query = vi.hoisted(() => ({ shape: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ form: query.shape }),
}));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("../src/lib/native/save-file", () => ({ saveNatively: vi.fn() }));
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
  it("saves CSV through the native share sheet and reports export errors", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
    vi.mocked(saveNatively).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("disk"));
    const error = vi.spyOn(toast, "error");
    show(<ResponsesView form={form} close={() => {}} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(saveNatively).toHaveBeenCalledWith(expect.any(Blob), "form-responses.csv", "text/csv"),
    );
    expect(error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't export your responses. Try again."),
    );
  });
  it("downloads browser CSV and revokes the object URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "web");
    const create = vi.fn(() => "blob:forms-export");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    show(<ResponsesView form={form} close={() => {}} />);
    await screen.findByRole("table");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toMatchObject({ download: "form-responses.csv" });
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith("blob:forms-export");
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
});

describe("forms home", () => {
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
