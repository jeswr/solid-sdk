// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  ImportedXmlComponent,
  type IParagraphOptions,
  type IRunOptions,
  LevelFormat,
  Paragraph,
  type ParagraphChild,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { validLink } from "../editor/logic";
import { embedDocument } from "./docx-payload";

export interface ExportImage {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  type: "png" | "jpg" | "gif" | "bmp";
}
export type ReadExportImage = (src: string) => Promise<ExportImage>;
const children = (node: JSONContent) => node.content ?? [];
const border = (size: number) => ({ style: BorderStyle.SINGLE, size, color: "808080" });
const codeFont = "Source Code Pro";
// A4 minus two 1in margins, in CSS pixels (docx converts pixels to EMUs).
export const PAGE_WIDTH = (11906 - 2880) / 15;

function inline(node: JSONContent, quote: boolean): ParagraphChild[] {
  if (node.type === "hardBreak") return [new TextRun({ break: 1 })];
  if (node.type !== "text") return children(node).flatMap((child) => inline(child, quote));
  const marks = new Set((node.marks ?? []).map((mark) => mark.type));
  const link = node.marks?.find((mark) => mark.type === "link");
  const href = validLink(String(link?.attrs?.href ?? ""));
  const options: IRunOptions = {
    text: node.text ?? "",
    bold: marks.has("bold"),
    italics: marks.has("italic"),
    strike: marks.has("strike"),
    subScript: marks.has("subscript"),
    superScript: marks.has("superscript"),
    ...(marks.has("underline") ? { underline: {} } : {}),
    ...(marks.has("highlight") ? { highlight: "yellow" } : {}),
    ...(marks.has("code")
      ? { style: "InlineCode", font: codeFont, shading: { fill: "F2F2F2" } }
      : {}),
    ...(href && !marks.has("code") ? { style: "Hyperlink" } : {}),
  };
  const run = new TextRun(options);
  return [href ? new ExternalHyperlink({ link: href, children: [run] }) : run];
}

/** Convert PM JSON directly: no HTML, editor, pod writes or remote snapshot needed. */
export async function toDocx(json: JSONContent, readImage: ReadExportImage): Promise<Document> {
  let listInstance = 0;
  const numberingConfig = (reference: string, start: number, listLevel: number) => ({
    reference,
    levels: Array.from({ length: 9 }, (_, level) => ({
      level,
      start: level === listLevel ? start : 1,
      format: reference === "bullets" ? LevelFormat.BULLET : LevelFormat.DECIMAL,
      text: reference === "bullets" ? "•" : `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  });
  const config = [numberingConfig("bullets", 1, 0)];
  async function blocks(
    nodes: JSONContent[],
    depth = -1,
    quote = false,
    numbering?: { reference: string; instance: number },
    task?: string,
  ): Promise<(Paragraph | Table)[]> {
    const result: (Paragraph | Table)[] = [];
    for (const node of nodes) {
      const content = children(node);
      const level = Math.min(Math.max(0, depth), 8);
      const paragraph: IParagraphOptions = {
        ...(quote ? { style: "Quote", indent: { left: 720 }, border: { left: border(24) } } : {}),
        ...(numbering ? { numbering: { ...numbering, level } } : {}),
        ...(depth >= 0 && !numbering && !task
          ? { style: "ListContinuation", indent: { left: 720 * (level + 1) } }
          : {}),
        ...(task
          ? {
              style: task === "☑ " ? "TaskChecked" : "TaskUnchecked",
              indent: { left: 720 * (level + 1) },
            }
          : {}),
      };
      switch (node.type) {
        case "paragraph":
        case "heading": {
          const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
          const alignment = {
            left: AlignmentType.LEFT,
            center: AlignmentType.CENTER,
            right: AlignmentType.RIGHT,
            justify: AlignmentType.JUSTIFIED,
          }[String(node.attrs?.textAlign)];
          result.push(
            new Paragraph({
              ...paragraph,
              ...(alignment ? { alignment } : {}),
              ...(node.type === "heading"
                ? { heading: headings[Number(node.attrs?.level) - 1] ?? HeadingLevel.HEADING_3 }
                : {}),
              children: [
                ...(task ? [new TextRun({ text: task, style: "TaskMarker" })] : []),
                ...content.flatMap((child) => inline(child, quote)),
              ],
            }),
          );
          // Only the first paragraph in a list item gets its marker.
          numbering = undefined;
          task = undefined;
          break;
        }
        case "bulletList":
        case "orderedList":
        case "taskList": {
          const instance = ++listInstance;
          const reference = node.type === "orderedList" ? `numbers-${instance}` : "bullets";
          if (node.type === "orderedList")
            config.push(
              numberingConfig(reference, Number(node.attrs?.start ?? 1), Math.min(depth + 1, 8)),
            );
          for (const item of content) {
            result.push(
              ...(await blocks(
                children(item),
                depth + 1,
                quote,
                node.type === "taskList" ? undefined : { reference, instance },
                node.type === "taskList" ? (item.attrs?.checked ? "☑ " : "☐ ") : undefined,
              )),
            );
          }
          break;
        }
        case "blockquote":
          result.push(...(await blocks(content, depth, true)));
          break;
        case "codeBlock":
          result.push(
            new Paragraph({
              ...paragraph,
              style: "Code",
              keepLines: true,
              shading: { fill: "F2F2F2" },
              children: content
                .map((child) => child.text ?? "")
                .join("")
                .split("\n")
                .flatMap((line, lineIndex) => [
                  ...(lineIndex ? [new TextRun({ break: 1 })] : []),
                  ...line
                    .split("\t")
                    .flatMap((text, index) => [
                      ...(index ? [new TextRun({ children: [new Tab()] })] : []),
                      new TextRun({ text, font: codeFont, size: 20 }),
                    ]),
                ]),
            }),
          );
          break;
        case "horizontalRule":
          result.push(new Paragraph({ style: "HorizontalRule", border: { bottom: border(48) } }));
          break;
        case "image": {
          const alt = String(node.attrs?.alt ?? "");
          try {
            const image = await readImage(String(node.attrs?.src ?? ""));
            const rawWidth = String(node.attrs?.width ?? "100%");
            const width = rawWidth.endsWith("%")
              ? (PAGE_WIDTH * Math.min(100, Math.max(1, Number.parseFloat(rawWidth)))) / 100
              : Math.min(PAGE_WIDTH, Math.max(1, Number(rawWidth)));
            result.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: image.data,
                    type: image.type,
                    transformation: { width, height: (width * image.height) / image.width },
                    altText: { name: alt, title: alt, description: alt },
                  }),
                ],
              }),
            );
          } catch {
            result.push(new Paragraph(`[Image unavailable: ${alt}]`));
          }
          break;
        }
        case "table": {
          const rows: TableRow[] = [];
          for (const row of content) {
            const cells: TableCell[] = [];
            for (const cell of children(row)) {
              cells.push(
                new TableCell({
                  children: await blocks(children(cell), -1, quote),
                  columnSpan: Number(cell.attrs?.colspan ?? 1),
                  rowSpan: Number(cell.attrs?.rowspan ?? 1),
                  borders: {
                    top: border(32),
                    bottom: border(32),
                    left: border(32),
                    right: border(32),
                  },
                }),
              );
            }
            rows.push(
              new TableRow({
                ...(children(row).every((cell) => cell.type === "tableHeader")
                  ? { tableHeader: true }
                  : {}),
                children: cells,
              }),
            );
          }
          result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
          break;
        }
        default:
          result.push(...(await blocks(content, depth, quote)));
      }
    }
    return result;
  }
  const document = new Document({
    numbering: { config },
    styles: {
      paragraphStyles: [
        { id: "Code", name: "Code", run: { font: codeFont, size: 20 } },
        { id: "Quote", name: "Quote", run: { italics: true } },
        { id: "ListContinuation", name: "List Continuation" },
        { id: "TaskChecked", name: "Task Checked" },
        { id: "TaskUnchecked", name: "Task Unchecked" },
        { id: "HorizontalRule", name: "Horizontal Rule" },
      ],
      characterStyles: [
        { id: "InlineCode", name: "Inline Code", run: { font: codeFont } },
        { id: "TaskMarker", name: "Task Marker" },
      ],
      default: {
        document: { run: { font: "Source Serif 4", size: 22 } },
        heading1: { run: { font: "Onest", size: 48, bold: true } },
        heading2: { run: { font: "Onest", size: 36, bold: true } },
        heading3: { run: { font: "Onest", size: 28, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: await blocks(children(json)),
      },
    ],
  });
  // WordprocessingML specifies font substitution through the font table's alternate name.
  for (const [name, fallback] of [
    ["Source Serif 4", "Georgia"],
    ["Onest", "Arial"],
    [codeFont, "Courier New"],
  ]) {
    document.FontTable.View.addChildElement(
      ImportedXmlComponent.fromXmlString(
        `<w:font w:name="${name}"><w:altName w:val="${fallback}"/></w:font>`,
      ),
    );
  }
  await embedDocument(document, json);
  return document;
}
