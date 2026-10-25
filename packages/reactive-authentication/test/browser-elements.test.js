// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from "vitest";

// A small DOM event seam: the elements' actual implementation owns their state,
// validation, abort handling and popup lifecycle. Real browser tests run separately.
class Node {
  listeners = new Map();
  value = "";
  returnValue = "";
  children = [];
  addEventListener(type, callback, options) {
    const list = this.listeners.get(type) ?? [];
    list.push({ callback, once: options?.once });
    this.listeners.set(type, list);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((x) => x.callback !== callback),
    );
  }
  async emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (listener.once) this.removeEventListener(type, listener.callback);
      await listener.callback(event);
    }
  }
  appendChild(child) {
    this.children.push(child);
  }
  cloneNode() {
    return { cloned: this };
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    void this.emit("close");
  }
  focus() {
    this.focused = true;
  }
  setSelectionRange(...range) {
    this.selection = range;
  }
}

class Element extends Node {
  nodes = new Map();
  view = new Node();
  options = [new Node()];
  webIdPicker = null;
  ownerDocument = {
    defaultView: this.view,
    createElement: () => ({ content: {} }),
    importNode: (value) => value,
  };
  node(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Node());
    return this.nodes.get(selector);
  }
  attachShadow() {
    return { appendChild() {}, querySelector: (selector) => this.node(selector) };
  }
  querySelector() {
    return this.webIdPicker;
  }
  querySelectorAll() {
    return this.options;
  }
}

let AuthorizationCodeFlow, IdpPicker, WebIdPicker;
beforeAll(async () => {
  vi.stubGlobal("HTMLElement", Element);
  ({ AuthorizationCodeFlow, IdpPicker, WebIdPicker } = await import("../src/elements.js"));
});
beforeEach(() => {
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name, options, body) => {
        if (body) options.signal?.throwIfAborted();
        return (body ?? options)();
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

test("WebID picker selects username templates, confirms, cancels and aborts", async () => {
  const picker = new WebIdPicker();
  picker.connectedCallback();
  assert.equal(picker.node("datalist").children[0].cloned, picker.options[0]);
  const input = picker.node("input");
  input.value = "https://example/YOUR_USERNAME/profile";
  await input.emit("change");
  assert.deepEqual(input.selection, [16, 29, "forward"]);
  input.value = "https://example/alice/profile";
  await input.emit("change");
  const pending = picker.getWebId(new Request("https://pod.example/private"));
  input.value = "https://example/alice#me";
  await picker.node("form").emit("submit");
  picker.node("dialog").close();
  assert.equal((await pending).href, input.value);
  const cancelled = picker.getWebId(new Request("https://pod.example/private"));
  const rejected = assert.rejects(cancelled, { name: "WebIdRequestCancelledError" });
  await picker.node("#cancel").emit("click");
  await rejected;
  const controller = new AbortController();
  const aborted = picker.getWebId(
    new Request("https://pod.example/private", { signal: controller.signal }),
  );
  const reason = new Error("navigation");
  const abortedCheck = assert.rejects(aborted, (error) => error === reason);
  controller.abort(reason);
  await abortedCheck;
});

test("issuer picker confirms suggestions and handles cancellation and abort", async () => {
  const picker = new IdpPicker();
  picker.connectedCallback();
  assert.equal(picker.node("#webid").hidden, true);
  picker.suggest(new URL("https://issuer.example/"));
  const pending = picker.getIssuer(new Request("https://pod.example/private"));
  assert.equal(picker.node("input").value, "https://issuer.example/");
  await picker.node("form").emit("submit");
  picker.node("dialog").close();
  assert.equal((await pending).href, "https://issuer.example/");
  const cancelled = picker.getIssuer(new Request("https://pod.example/private"));
  const rejected = assert.rejects(cancelled, { name: "IssuerRequestCancelledError" });
  await picker.node("#cancel").emit("click");
  await rejected;
  const controller = new AbortController();
  const aborted = picker.getIssuer(
    new Request("https://pod.example/private", { signal: controller.signal }),
  );
  const rejectedAbort = assert.rejects(aborted, /navigation/);
  controller.abort(new Error("navigation"));
  await rejectedAbort;
});

test("issuer picker reads a slotted WebID and restores controls after profile errors", async () => {
  const picker = new IdpPicker();
  picker.webIdPicker = { getWebId: async () => new URL("https://alice.example/#me") };
  picker.connectedCallback();
  assert.equal(picker.node("#webid").hidden, false);
  const pending = picker.getIssuer(new Request("https://pod.example/private"));
  picker.http = {
    fetch: async () =>
      new Response(
        "<https://alice.example/#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://issuer.example/> .",
      ),
  };
  await picker.node("#webid").emit("click");
  assert.equal(picker.node("input").value, "https://issuer.example/");
  picker.http = { fetch: async () => new Response("") };
  await assert.rejects(picker.node("#webid").emit("click"), /lacks OIDC issuer/);
  assert.equal(picker.node("#webid").disabled, false);
  assert.equal(picker.node("input").focused, true);
  await picker.node("form").emit("submit");
  picker.node("dialog").close();
  assert.equal((await pending).href, "https://issuer.example/");
});

function flow() {
  const element = new AuthorizationCodeFlow();
  element.connectedCallback();
  const popup = { closed: false, close: vi.fn(), focus: vi.fn() };
  vi.stubGlobal(
    "open",
    vi.fn(() => popup),
  );
  return { element, popup };
}
const authorization = new URL(
  "https://issuer.example/authorize?redirect_uri=https://app.example/callback",
);

test("authorization popup validates messages and disposes the completed popup", async () => {
  const { element, popup } = flow();
  const pending = element.getCode(authorization, new AbortController().signal);
  const send = (data, source = popup, origin = "https://app.example") =>
    element.view.emit("message", { data, source, origin });
  for (const [data, source, origin] of [
    ["https://app.example/callback", null],
    ["https://app.example/callback", {}],
    ["https://app.example/callback", popup, "https://evil.example"],
    [42],
    ["x".repeat(8193)],
    ["invalid"],
    ["https://evil.example/callback"],
  ])
    await send(data, source, origin);
  await send("https://app.example/callback?code=c&state=s");
  const result = await pending;
  assert.equal(result.value, "https://app.example/callback?code=c&state=s");
  result[Symbol.dispose]();
  element.cleanup();
  assert.equal(popup.close.mock.calls.length, 2);
  await assert.rejects(
    element.getCode(new URL("https://issuer.example/a"), new AbortController().signal),
    /redirect_uri/,
  );
});

test("popup blocking, open/focus buttons, cancellation and user closure release the flow", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { element, popup } = flow();
  globalThis.open.mockReturnValueOnce(null);
  const pending = element.getCode(authorization, new AbortController().signal);
  assert.equal(element.node("dialog[part *= 'new']").open, true);
  await vi.advanceTimersByTimeAsync(500);
  const submit = (value) =>
    element.node("form").emit("submit", { preventDefault() {}, submitter: { value } });
  await submit("open");
  await submit("focus");
  assert.equal(popup.focus.mock.calls.length, 1);
  await submit("other");
  const rejected = assert.rejects(pending, { name: "CodeRequestCancelledError" });
  await submit("cancel");
  await rejected;
  const second = element.getCode(authorization, new AbortController().signal);
  const closed = assert.rejects(second, { name: "CodeRequestCancelledError" });
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(500);
  await closed;
  const controller = new AbortController();
  popup.closed = false;
  const third = element.getCode(authorization, controller.signal);
  const aborted = assert.rejects(third, /navigation/);
  controller.abort(new Error("navigation"));
  await aborted;
});

test("element registration preserves all three public tag names", async () => {
  const define = vi.fn();
  vi.stubGlobal("customElements", { define });
  await import("../src/registerElements.js");
  assert.deepEqual(define.mock.calls, [
    ["authorization-code-flow", AuthorizationCodeFlow],
    ["idp-picker", IdpPicker],
    ["webid-picker", WebIdPicker],
  ]);
});
