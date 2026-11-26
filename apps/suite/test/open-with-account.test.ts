// AUTHORED-BY Codex GPT-6.2-Astra
import { expect, it, vi } from "vitest";
import { OpenWithAccount } from "../src/components/open-with-account";
import { h, mount } from "./drive-ui-dom";

it.each([
  { url: "https://pod.example/bob/notes/plan.ttl", kind: "note", scope: "this note." },
  {
    url: "https://pod.example/bob/sheets/book/",
    kind: "spreadsheet",
    scope: "this spreadsheet and everything inside it.",
  },
])("explains where the suite sends the sign-in for $kind", async ({ url, kind, scope }) => {
  const open = vi.fn();
  const view = await mount(h(OpenWithAccount, { url, kind, open }));
  const copy = view.host.querySelector("p")?.textContent;
  expect(copy).toContain("Until you sign out of this session, the suite will send your sign-in");
  expect(copy).toContain(`read or change ${scope}`);
  expect(view.host.textContent).toContain(url.slice("https://".length));
  expect(open).not.toHaveBeenCalled();
});
