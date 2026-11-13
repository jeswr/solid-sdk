// AUTHORED-BY Codex GPT-6.1-Sol
import { assert, expect, it, vi } from "vitest";
import { buildDocument } from "../src/apps/docs/lib/model/document";
import { buildNote, type NoteRevision, parseNote } from "../src/apps/notes/lib/model/note";
import { createDraftRegistry } from "../src/apps/notes/state/draft-registry";

const url = "https://pod.example/notes/history.ttl";
const now = new Date("2026-11-11T12:00:00Z");
const author = "https://pod.example/profile#me";

it("round-trips revision titles, including an empty title, and preserves missing legacy titles", () => {
  const first = parseNote(url, buildNote(url, { title: "", body: "First", now }), "active");
  expect(first?.revisions[0]?.title).toBe("");
  const next = parseNote(
    url,
    buildNote(url, {
      title: "New title",
      body: "Second",
      now: new Date(now.getTime() + 600_000),
      priorRevisions: first?.revisions,
    }),
    "active",
  );
  expect(next?.revisions.map((revision) => revision.title)).toEqual(["New title", ""]);
  const legacy = parseNote(
    url,
    buildDocument(url, { title: "Legacy", body: "Old", now }),
    "active",
  );
  expect(legacy?.revisions[0]?.title).toBeUndefined();
});

it("captures replaced content inside the automatic interval and keeps repeated restores undoable", () => {
  const original = parseNote(
    url,
    buildNote(url, { title: "Original", body: "Original", now }),
    "active",
  );
  const prior = original?.revisions as NoteRevision[];
  const frozen = JSON.stringify(prior);
  const restored = parseNote(
    url,
    buildNote(url, {
      title: "Restored",
      body: "Restored",
      now,
      priorRevisions: prior,
      beforeRestore: { title: "Pending title", body: "Unsnapshotted edits" },
      editor: author,
    }),
    "active",
  );
  expect(JSON.stringify(prior)).toBe(frozen);
  expect(restored?.revisions[0]).toMatchObject({
    title: "Pending title",
    body: "Unsnapshotted edits",
    label: "Before restore",
    attributedTo: author,
  });
  const again = parseNote(
    url,
    buildNote(url, {
      title: "Pending title",
      body: "Unsnapshotted edits",
      now,
      priorRevisions: restored?.revisions,
      beforeRestore: { title: "Restored", body: "Restored" },
      creator: author,
    }),
    "active",
  );
  expect(again?.revisions.map((revision) => revision.title)).toEqual([
    "Restored",
    "Pending title",
    "Original",
  ]);
  expect(again?.revisions[0]?.wasRevisionOf).toBe(again?.revisions[1]?.id);
  expect(again?.revisions[1]?.body).toBe("Unsnapshotted edits");
});

it("retains at most twenty revisions even when each restore creates a safety snapshot", () => {
  let revisions: NoteRevision[] = [];
  for (let index = 0; index < 23; index++) {
    const parsed = parseNote(
      url,
      buildNote(url, {
        title: `${index}`,
        body: `${index}`,
        now,
        priorRevisions: revisions,
        beforeRestore: { title: `Before ${index}`, body: `Before ${index}` },
      }),
      "active",
    );
    revisions = parsed?.revisions as NoteRevision[];
  }
  expect(revisions).toHaveLength(20);
  expect(revisions[0]?.title).toBe("Before 22");
  expect(revisions.at(-1)?.wasRevisionOf).toBeUndefined();
  expect(new Set(revisions.map((revision) => revision.id)).size).toBe(20);
});

it("persists restore intent and revision titles across draft-registry recovery", () => {
  const parsed = parseNote(url, buildNote(url, { title: "Current", now }), "active");
  assert(parsed);
  const note = {
    ...parsed,
    etag: '"one"',
  };
  const storage = new Map<string, string>();
  const seams = {
    tabId: "history",
    now: () => now.getTime(),
    storage: {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  };
  const pending = createDraftRegistry(author, seams);
  pending.change(
    note,
    { title: "Restored", body: "Old", labels: [], preserveCurrent: true },
    vi.fn(),
  );
  const recovered = createDraftRegistry(author, seams).get(url);
  expect(recovered?.note.revisions[0]?.title).toBe("Current");
  expect(recovered?.draft).toMatchObject({ title: "Restored", body: "Old", preserveCurrent: true });
});
