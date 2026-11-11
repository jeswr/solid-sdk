// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { toast } from "@jeswr/suite-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { sampleForms } from "../src/apps/forms/demo/sample";
import { openDemoFormsStore } from "../src/apps/forms/lib/data/demo-store";
import { createMemoryFormsStore } from "../src/apps/forms/lib/data/memory-store";
import { formRuntime } from "../src/apps/forms/lib/runtime";
import { FormsProvider, useForms, useFormsState } from "../src/apps/forms/state/forms-context";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("../src/apps/forms/lib/data/demo-store", () => ({ openDemoFormsStore: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: { error: vi.fn() } }));
const root = "https://pod.example/";
const demo: PodSession = {
  mode: "demo",
  storageUrl: root,
  webId: `${root}profile#me`,
  displayName: "Demo",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: async () => {},
};
function Probe() {
  const { session } = useForms();
  const state = useFormsState();
  return (
    <p>
      {session.displayName} · {state.status} · {state.forms.length}
    </p>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  formRuntime.current = null;
  formRuntime.openStore = null;
});
describe("Forms session context", () => {
  it("uses only the installed production runtime and host store for real sessions", async () => {
    const real = { ...demo, mode: "extension" } as unknown as PodSession;
    formRuntime.current = {
      compileForm: vi.fn(),
      validate: vi.fn(),
      build: vi.fn(),
      parse: vi.fn(),
      serialize: vi.fn(),
      formToShapes: vi.fn(),
    };
    const incomplete = render(
      <FormsProvider session={real} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
    incomplete.unmount();
    formRuntime.openStore = vi.fn(async () => createMemoryFormsStore(root, sampleForms(root)));
    render(
      <FormsProvider session={real} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    await screen.findByText("Demo · ready · 2");
    expect(formRuntime.openStore).toHaveBeenCalledWith(real, formRuntime.current);
    expect(openDemoFormsStore).not.toHaveBeenCalled();
  });
  it("discards late opening failures after unmount", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(openDemoFormsStore).mockReturnValueOnce(
      new Promise((_yes, no) => {
        reject = no;
      }),
    );
    const view = render(
      <FormsProvider session={demo} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    view.unmount();
    await act(async () => reject(new Error("offline")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reports asynchronous save failures with a toast", async () => {
    const store = createMemoryFormsStore(root, sampleForms(root));
    vi.spyOn(store, "saveForm").mockRejectedValue(new Error("offline"));
    function Save() {
      const { controller } = useForms();
      return (
        <button
          type="button"
          onClick={() => {
            const form = sampleForms(root).forms[0];
            if (form) void controller.save(form).catch(() => {});
          }}
        >
          Save
        </button>
      );
    }
    render(
      <FormsProvider session={demo} store={store} unavailable={null}>
        <Save />
      </FormsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't save")),
    );
  });
  it("requires a provider for either hook", () => {
    expect(() => render(<Probe />)).toThrow("FormsProvider is required");
    function StateProbe() {
      useFormsState();
      return null;
    }
    expect(() => render(<StateProbe />)).toThrow("FormsProvider is required");
  });
  it("uses an injected store and subscribes to optimistic state", async () => {
    const store = createMemoryFormsStore(root, sampleForms(root));
    render(
      <FormsProvider session={demo} store={store} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    await screen.findByText("Demo · ready · 2");
    expect(openDemoFormsStore).not.toHaveBeenCalled();
  });
  it("loads the demo double and reports failed opening", async () => {
    vi.mocked(openDemoFormsStore).mockResolvedValueOnce(
      createMemoryFormsStore(root, sampleForms(root)),
    );
    const view = render(
      <FormsProvider session={demo} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    await screen.findByText("Demo · ready · 2");
    view.unmount();
    vi.mocked(openDemoFormsStore).mockRejectedValueOnce(new Error("offline"));
    render(
      <FormsProvider session={demo} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't open"));
  });
  it("never substitutes demo data for a real session", () => {
    const real = { ...demo, mode: "extension" } as unknown as PodSession;
    render(
      <FormsProvider session={real} unavailable={<p>Runtime unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    expect(screen.getByText("Runtime unavailable")).toBeTruthy();
    expect(openDemoFormsStore).not.toHaveBeenCalled();
  });
  it("discards late results after unmount", async () => {
    let resolve!: (store: ReturnType<typeof createMemoryFormsStore>) => void;
    vi.mocked(openDemoFormsStore).mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const view = render(
      <FormsProvider session={demo} unavailable={<p>Unavailable</p>}>
        <Probe />
      </FormsProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Opening");
    view.unmount();
    await act(async () => resolve(createMemoryFormsStore(root, sampleForms(root))));
    expect(screen.queryByText("Demo · ready · 2")).toBeNull();
  });
});
