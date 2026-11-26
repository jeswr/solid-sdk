// AUTHORED-BY Codex GPT-6.1-Sol
import {
  CellValueType,
  CustomRangeType,
  DataStreamTreeTokenType,
  getPlainText,
  type ICellData,
  type IWorkbookData,
} from "@univerjs/core";
import { validLink } from "../../docs/lib/editor/logic";
import type { Snapshot } from "./model/snapshot";

// Docs owns the suite's URL policy: no credentials, controls or executable schemes.
export { validLink };

type LinkCell = ICellData & { linkUrl?: string; linkId?: string };

/** Univer 1.2's link form prefixes mailto inputs; repair that before validation. */
export function presetLinkTarget(input: string): string | null {
  return validLink(input.replace(/^(?:http:\/\/)?mailto:(?:\/\/)?/i, "mailto:"));
}

/** Hyperlink delimiters are engine tokens, never part of a cell's visible text. */
export function linkPlainText(dataStream: string): string {
  return getPlainText(dataStream)
    .replaceAll(DataStreamTreeTokenType.CUSTOM_RANGE_START, "")
    .replaceAll(DataStreamTreeTokenType.CUSTOM_RANGE_END, "");
}

/** CSV has no label/target pair, so linked cells project their safe URL text. */
export function cellLinkUrls(cell: LinkCell): string[] {
  const urls = (cell.p?.body?.customRanges ?? [])
    .filter((range) => range.rangeType === CustomRangeType.HYPERLINK)
    .map((range) => validLink(String(range.properties?.url ?? "")))
    .filter((url): url is string => url !== null);
  const legacy = validLink(cell.linkUrl ?? "");
  return legacy ? [...urls, legacy] : urls;
}

/** Strip unsafe imported/pasted links without losing their visible label. */
export function sanitizeCellLinks(cell: LinkCell): LinkCell {
  const result = { ...cell };
  if (cell.linkUrl !== undefined && !validLink(cell.linkUrl)) {
    delete result.linkUrl;
    delete result.linkId;
  }
  const body = cell.p?.body;
  if (
    body?.customRanges?.some(
      (range) =>
        range.rangeType === CustomRangeType.HYPERLINK &&
        !validLink(String(range.properties?.url ?? "")),
    )
  ) {
    // Flatten this cell as a unit: removing only ranges leaves orphaned rich-text
    // delimiters and invalid offsets for the remaining ranges and formatting.
    // Cell mutations merge their input, so null must explicitly clear old rich text.
    result.p = null;
    result.v = linkPlainText(body.dataStream);
    result.t = CellValueType.STRING;
  }
  return result;
}

/** Run before createWorkbook, including conflict reloads and imported snapshots. */
export function sanitizeWorkbookLinks(snapshot: Snapshot): Snapshot {
  const data = structuredClone(snapshot) as unknown as IWorkbookData;
  for (const sheet of Object.values(data.sheets ?? {})) {
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const [column, cell] of Object.entries(row)) {
        if (cell) row[Number(column)] = sanitizeCellLinks(cell);
      }
    }
  }
  return data as unknown as Snapshot;
}
