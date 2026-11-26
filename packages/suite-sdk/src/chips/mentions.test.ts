// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChipRef, chipText } from "./core.js";
import {
  addedChipRefs,
  htmlChipRefs,
  notifySavedChips,
  notifySavedHtml,
  notifySavedText,
} from "./mentions.js";

const { notify, createNotify } = vi.hoisted(() => ({
  notify: vi.fn(async () => ({ delivered: true })),
  createNotify: vi.fn(),
}));
vi.mock("@jeswr/pod-access/notify", async (original) => ({
  ...(await original<object>()),
  createNotify: createNotify.mockReturnValue(notify),
}));
const bob: ChipRef = { iri: "https://bob.example/#me", kind: "person", label: "Bob" };
const cat: ChipRef = { iri: "https://cat.example/#me", kind: "person", label: "Cat" };
const resource = "https://pod.example/document";
const anchor = (ref: ChipRef) =>
  `<a data-chip data-chip-kind="person" href="${ref.iri}" data-chip-label="${ref.label}">${ref.label}</a>`;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
describe("saved mention deltas", () => {
  it("diffs exact person sets, ignoring labels, ordering, duplicates and nonpeople", () => {
    expect(
      addedChipRefs(
        [bob],
        [
          cat,
          bob,
          { ...bob, label: "Robert" },
          cat,
          { ...cat, kind: "file" },
          { ...bob, iri: "bad" },
        ],
      ),
    ).toEqual([cat]);
    expect(addedChipRefs([{ ...bob, kind: "file" }], [bob])).toEqual([bob]);
  });
  it("extracts only explicit absolute HTTP(S) hrefs without browser-origin resolution", () => {
    expect(
      htmlChipRefs(
        `<base href="https://evil.example/">${anchor(bob)}<a data-chip data-chip-kind="person" href="https://cat.example/#me">Cat</a><a data-chip data-chip-kind="person" href="https://empty.example/"></a>` +
          [
            "",
            ' href=""',
            ' href="relative"',
            ' href="/person"',
            ' href="javascript:bad"',
            ' href="https://u:p@evil.example/"',
          ]
            .map((attrs) => `<a data-chip data-chip-kind="person"${attrs}>Bad</a>`)
            .join("") +
          '<a data-chip data-chip-kind="file" href="https://pod.example/file">File</a>',
      ),
    ).toEqual([bob, cat, { iri: "https://empty.example/", kind: "person", label: "" }]);
  });
  it("notifies only added people after HTML/text saves and sends only the supplied title", async () => {
    const session = { fetch: vi.fn(), webId: "https://alice.example/#me" };
    await notifySavedHtml(
      session,
      resource,
      anchor(bob),
      `Private body ${anchor(bob)} ${anchor(cat)}`,
      "Document title",
    );
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      cat.iri,
      expect.objectContaining({ summary: "Mentioned you: Document title", actor: session.webId }),
    );
    await notifySavedHtml(
      session,
      resource,
      anchor(cat),
      `${anchor(cat)} typo fixed`,
      "Document title",
    );
    await notifySavedText(
      session,
      resource,
      chipText(bob),
      `${chipText(bob)} private`,
      "Task title",
    );
    expect(notify).toHaveBeenCalledTimes(1);
    await notifySavedText(session, resource, "", `${chipText(bob)} private`, "Task title");
    expect(createNotify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(
      bob.iri,
      expect.objectContaining({ summary: "Mentioned you: Task title" }),
    );
    // Different actors sharing a transport still receive separate notifier/receipt scope.
    await notifySavedChips(
      { ...session, webId: "https://dana.example/#me" },
      resource,
      [],
      [bob],
      "Title",
    );
    expect(createNotify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(3);
  });
});
