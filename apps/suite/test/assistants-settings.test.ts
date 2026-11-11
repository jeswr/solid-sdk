// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuditSource, PersonalDataRead } from "@jeswr/mcp-connections";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/types";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  state: { status: "loading" } as Record<string, unknown>,
  url: undefined as string | undefined,
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/lib/session/shell-pod-session", () => ({ usePodSessionState: () => mocks.state }));
vi.mock("../src/shell/environment", () => ({
  useSuiteEnvironment: () => ({ NEXT_PUBLIC_SUITE_MCP_URL: mocks.url }),
}));

import {
  AssistantSettings,
  ConnectAssistant,
  PersonalDataReads,
} from "../src/shell/settings/assistants/assistants";

const URL = "https://mcp.example/mcp";
function session(id = "alice"): PodSession {
  return {
    mode: "solid",
    webId: `https://${id}.example/profile#me`,
    displayName: id,
    storageUrl: `https://${id}.example/`,
    fetch: vi.fn(),
    publicFetch: vi.fn(),
    subscribe: () => () => {},
  };
}
const row: PersonalDataRead = {
  at: "2026-11-01T12:00:00.000Z",
  client: "https://mcp.example/clients/opaque-secret",
  tool: "health_query",
  purpose: "https://w3id.org/dpv#ServiceProvision",
  categories: ["https://w3id.org/dpv/pd#Health"],
  resourceCount: 2,
  source: "monthly",
};
const source = (list = vi.fn().mockResolvedValue([row])): AuditSource => ({ list });
function button(host: HTMLElement, name: string) {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent === name,
  );
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mocks.state = { status: "loading" };
  mocks.url = undefined;
});
it("shows unset setup text and the single-user token rotation footnote", async () => {
  const { host } = await mount(h(ConnectAssistant, { url: undefined }));
  expect(host.textContent).toContain(
    "This suite has no assistant server set up. Ask whoever runs your suite for its MCP address.",
  );
  expect(host.textContent).toContain("rotating MCP_ACCESS_TOKEN");
  expect(host.textContent).toContain("no connection records are written");
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector('[role="tablist"]')).toBeNull();
});
it("copies only the configured read-only URL, handles failure, and switches verbatim setup tabs", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { host } = await mount(h(ConnectAssistant, { url: URL }));
  expect(host.querySelector("input")?.readOnly).toBe(true);
  expect(host.querySelector("input")?.value).toBe(URL);
  expect(host.textContent).toContain("Leave Advanced settings empty.");
  expect(host.textContent).toContain("Turn it on from the tools menu in a chat.");
  await click(button(host, "Copy assistant server address"));
  expect(writeText).toHaveBeenCalledWith(URL);
  expect(host.textContent).toContain("Copied");
  writeText.mockRejectedValue(new Error("private clipboard failure"));
  await click(button(host, "Copy assistant server address"));
  expect(host.textContent).toContain("Couldn't copy. Select and copy the text.");
  await key(button(host, "ChatGPT"), "Enter");
  expect(button(host, "ChatGPT").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).toContain(
    "Developer mode needs a paid plan and isn't in the desktop app. Pick it from the + menu in a chat.",
  );
  expect(host.textContent).toContain(
    `Name it "Solid pod", paste ${URL}, and choose OAuth for authentication.`,
  );
  expect(host.textContent).not.toContain("Leave Advanced settings empty.");
  expect(host.textContent).toContain("Other MCP apps: use this address with OAuth.");
});
it("renders loading, whitelisted metadata with labels and a count, empty, and error with Retry", async () => {
  const pending = deferred<PersonalDataRead[]>();
  const list = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("secret backend value"))
    .mockResolvedValueOnce([]);
  const audit = source(list);
  const account = session();
  const view = await mount(h(PersonalDataReads, { session: account, source: audit }));
  expect(view.host.textContent).toContain("Loading personal data reads");
  await act(() =>
    pending.resolve([
      row,
      {
        ...row,
        client: "https://assistant.example/app",
        purpose: "urn:unknown",
        categories: ["urn:unknown"],
        decision: "prohibited",
      },
    ]),
  );
  expect(list).toHaveBeenCalledWith(expect.any(Function), account.storageUrl, 100);
  expect(view.host.textContent).toContain("An assistant registered with mcp.example");
  expect(view.host.textContent).toContain("Tool: health_query");
  expect(view.host.textContent).toContain("Purpose: Provide the service");
  expect(view.host.textContent).toContain("Health");
  expect(view.host.textContent).toContain("2 resources");
  expect(view.host.textContent).toContain("assistant.example");
  expect(view.host.textContent).toContain("Other personal data");
  expect(view.host.textContent).not.toMatch(/opaque-secret|urn:unknown/);
  const other = session("bob");
  await view.render(h(PersonalDataReads, { session: other, source: audit }));
  expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
  expect(view.host.textContent).not.toContain("secret backend value");
  await click(button(view.host, "Retry"));
  expect(view.host.textContent).toContain("No personal data reads yet");
});
it("drops previous-account rows immediately and ignores late successful or failed completions", async () => {
  const first = deferred<PersonalDataRead[]>();
  const second = deferred<PersonalDataRead[]>();
  const audit = source(
    vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
  );
  const view = await mount(h(PersonalDataReads, { session: session(), source: audit }));
  await view.render(h(PersonalDataReads, { session: session("bob"), source: audit }));
  await act(() => first.resolve([row]));
  expect(view.host.textContent).not.toContain("mcp.example");
  await act(() => second.resolve([]));
  expect(view.host.textContent).toContain("No personal data reads yet");
  const late = deferred<PersonalDataRead[]>();
  const secondView = await mount(
    h(PersonalDataReads, {
      session: session(),
      source: source(vi.fn().mockReturnValue(late.promise)),
    }),
  );
  await secondView.unmount();
  await act(() => late.reject(new Error("private")));
});
it("hides reads offline, ignores in-flight replies, and reloads on reconnection", async () => {
  const pending = deferred<PersonalDataRead[]>();
  const list = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
  const view = await mount(h(PersonalDataReads, { session: session(), source: source(list) }));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(view.host.textContent).toContain("Reconnect to load personal data reads.");
  await act(() => pending.resolve([row]));
  expect(view.host.textContent).not.toContain("mcp.example");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(() => window.dispatchEvent(new Event("online")));
  expect(list).toHaveBeenCalledTimes(2);
  expect(view.host.textContent).toContain("No personal data reads yet");
});
it("bounds a stalled source even when it ignores its abort signal", async () => {
  vi.useFakeTimers();
  try {
    const view = await mount(
      h(PersonalDataReads, {
        session: session(),
        source: source(vi.fn().mockReturnValue(new Promise(() => {}))),
      }),
    );
    await act(() => vi.advanceTimersByTime(10001));
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    await view.unmount();
  } finally {
    vi.useRealTimers();
  }
});
it("shows session loading, signed-out and unavailable states with the configured setup", async () => {
  mocks.url = URL;
  const view = await mount(h(AssistantSettings));
  expect(view.host.textContent).toContain("Opening your pod");
  mocks.state = { status: "signed-out" };
  await view.render(h(AssistantSettings));
  expect(view.host.textContent).toContain("Sign in to see personal data reads.");
  mocks.state = { status: "error" };
  await view.render(h(AssistantSettings));
  expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
  const ready = { ...session(), fetch: async () => new Response(null, { status: 404 }) };
  mocks.state = { status: "ready", session: ready };
  await view.render(h(AssistantSettings));
  expect(view.host.textContent).toContain("No personal data reads yet");
});
