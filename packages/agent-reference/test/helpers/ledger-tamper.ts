// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync, writeFileSync } from "fs";
import { recordEntryDataset, recordGraphIri } from "../../src/model/store/record.js";
import { AWP } from "../../src/profile/vocabulary.js";
import { type LedgerEntry, readLedgerSegment } from "../../src/store/ledger.js";
import { readNQuads, writeNQuads } from "../../src/wire/store-quads.js";

export function tamperLedgerEntry(path: string, entry: LedgerEntry, mutated: LedgerEntry): void {
  const original = readFileSync(path, "utf8");
  let changed: string;
  if (original.trimStart().startsWith("{")) {
    changed = original.replace(JSON.stringify(entry), JSON.stringify(mutated));
  } else {
    const graph = recordGraphIri(entry.hash);
    const replacement = writeNQuads(recordEntryDataset(mutated));
    readNQuads(replacement);
    const block = replacement.trimEnd().split("\n");
    const hash = block.findIndex((line) => line.startsWith(`<${graph}> <${AWP}entryHash> `));
    if (hash < 0) throw new TypeError("Missing replacement hash quad");
    block.push(...block.splice(hash, 1));
    const lines = original.split("\n");
    const first = lines.findIndex((line) => line.trimEnd().endsWith(`<${graph}> .`));
    if (first < 0) throw new Error("Entry graph not found");
    let end = first;
    while (lines[end]?.trimEnd().endsWith(`<${graph}> .`)) end++;
    lines.splice(first, end - first, ...block);
    changed = lines.join("\n");
  }
  if (changed === original) throw new Error("Ledger tamper left the file unchanged");
  writeFileSync(path, changed);
  const actual = readLedgerSegment(path).find((row) => row.seq === entry.seq);
  if (!actual || JSON.stringify(actual.record) !== JSON.stringify(mutated.record))
    throw new Error("Ledger tamper did not leave a decodable mutation");
}
