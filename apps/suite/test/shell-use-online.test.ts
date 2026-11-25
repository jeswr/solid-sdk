// AUTHORED-BY Codex GPT-6.1-Sol
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { useOnline } from "../src/shell/lib/use-online";
import { act, h, mount } from "./drive-ui-dom";

function Status() {
  return h("span", null, useOnline() ? "online" : "offline");
}
it("uses a stable server snapshot and follows browser connectivity until unmount", async () => {
  expect(renderToString(h(Status))).toContain("online");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const view = await mount(h(Status));
  expect(view.host.textContent).toBe("offline");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(() => window.dispatchEvent(new Event("online")));
  expect(view.host.textContent).toBe("online");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(view.host.textContent).toBe("offline");
  await view.unmount();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(() => window.dispatchEvent(new Event("online")));
});
