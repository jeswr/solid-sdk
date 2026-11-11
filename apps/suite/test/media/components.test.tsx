// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { MediaRecord } from "@jeswr/solid-media-log";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";
import { MediaCard } from "../../src/apps/media/components/media-card";
import { MediaImportDialog } from "../../src/apps/media/components/media-import";
import { MediaStats } from "../../src/apps/media/components/media-stats";

const record: MediaRecord = {
  id: "https://pod.example/media/1",
  url: "https://pod.example/media/1",
  etag: '"1"',
  data: { title: "The Copper Shore", year: 2025, kind: "film", status: "want" },
};
afterEach(cleanup);
it("keeps the visible action text in accessible names and uses a card h3", () => {
  const edit = vi.fn();
  const finish = vi.fn();
  render(<MediaCard record={record} offline={false} onEdit={edit} onFinish={finish} />);
  expect(screen.getByRole("heading", { level: 3, name: "The Copper Shore" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit & review The Copper Shore" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark finished: The Copper Shore" }));
  expect(edit).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledOnce();
});
it("keeps an unconfirmed saved item visible with an honest confirmation notice", () => {
  render(
    <MediaCard
      record={{ ...record, unconfirmed: true }}
      offline
      onEdit={() => {}}
      onFinish={() => {}}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("awaiting confirmation");
  expect(
    (screen.getByRole("button", { name: "Mark finished: The Copper Shore" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("uses an h2 for the monthly stats section", () => {
  render(
    <MediaStats
      records={[
        {
          ...record,
          data: {
            ...record.data,
            status: "finished",
            finished: `${new Date().getFullYear()}-02-03`,
          },
        },
      ]}
    />,
  );
  expect(screen.getByRole("heading", { level: 2, name: "Finished each month" })).toBeTruthy();
});
async function chooseCsv(bytes: Uint8Array) {
  const file = new File([], "watched.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  fireEvent.change(screen.getByLabelText("CSV file (up to 4 MiB, 5,000 rows)"), {
    target: { files: [file] },
  });
  await screen.findByText(/ready to import/);
}
it("shows the legacy decoding notice and keeps accented titles readable", async () => {
  const onImport = vi.fn();
  render(<MediaImportDialog records={[]} offline={false} onClose={() => {}} onImport={onImport} />);
  const utf8 = new TextEncoder().encode("Name,Year\nCaf");
  await chooseCsv(new Uint8Array([...utf8, 233, ...new TextEncoder().encode(",2025")]));
  expect(screen.getByText(/decoded it as Windows-1252/)).toBeTruthy();
  expect(screen.getByText("Café (2025)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import 1 item" }));
  expect(onImport).toHaveBeenCalledWith([expect.objectContaining({ title: "Café" })], 0);
});
it("previews diary rows as duplicates of existing watched rows despite different URLs", async () => {
  render(
    <MediaImportDialog
      records={[
        {
          ...record,
          data: {
            ...record.data,
            status: "finished",
            origin: "https://letterboxd.com/film/the-copper-shore/",
          },
        },
      ]}
      offline={false}
      onClose={() => {}}
      onImport={() => {}}
    />,
  );
  await chooseCsv(
    new TextEncoder().encode(
      "Name,Year,Watched Date,Letterboxd URI\nThe Copper Shore,2025,2026-11-10,https://letterboxd.com/aster-fiction/film/the-copper-shore/1/",
    ),
  );
  expect(
    screen.getByText("0 ready to import · 0 skipped · 1 already in your library"),
  ).toBeTruthy();
  expect((screen.getByRole("button", { name: "Import items" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it("keeps a diary completion ready to import when the work is still on the watchlist", async () => {
  const onImport = vi.fn();
  render(
    <MediaImportDialog records={[record]} offline={false} onClose={() => {}} onImport={onImport} />,
  );
  await chooseCsv(
    new TextEncoder().encode(
      "Name,Year,Watched Date,Rating,Review\nThe Copper Shore,2025,2026-11-10,4.5,A favourite",
    ),
  );
  expect(
    screen.getByText("1 ready to import · 0 skipped · 0 already in your library"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import 1 item" }));
  expect(onImport).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        status: "finished",
        finished: "2026-11-10",
        rating: 4.5,
        review: "A favourite",
      }),
    ],
    0,
  );
});
