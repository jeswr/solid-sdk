// AUTHORED-BY Codex
// Run from apps/suite: node e2e/fixtures/generate-docs-docx.mjs
import { writeFile } from "node:fs/promises";
import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
const document = new Document({
  creator: "AUTHORED-BY Codex — Docs conversion fixture",
  created: new Date("2026-10-26T00:00:00Z"),
  modified: new Date("2026-10-26T00:00:00Z"),
  numbering: {
    config: [
      { reference: "fixture", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•" }] },
    ],
  },
  footnotes: { 1: { children: [new Paragraph("This footnote must be reported and omitted.")] } },
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Plan" }),
        new Paragraph({ numbering: { reference: "fixture", level: 0 }, text: "Prepare launch" }),
        new Table({
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ children: [new Paragraph("Owner")] }),
                new TableCell({ children: [new Paragraph("Task")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Alice")] }),
                new TableCell({ children: [new Paragraph("Review")] }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              data: png,
              type: "png",
              transformation: { width: 32, height: 32 },
              altText: {
                name: "Fixture image",
                title: "Fixture image",
                description: "Fixture image",
              },
            }),
          ],
        }),
        new Paragraph({ children: [new TextRun("Source"), new FootnoteReferenceRun(1)] }),
      ],
    },
  ],
});
await writeFile(new URL("docs-import.docx", import.meta.url), await Packer.toBuffer(document));
