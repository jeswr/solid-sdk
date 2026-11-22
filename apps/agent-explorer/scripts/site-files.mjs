// AUTHORED-BY Codex GPT-6
// Report actual UTF-8/on-disk sizes of the files that will be published.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function siteFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push({ file: relative(root, path), bytes: statSync(path).size });
    }
  }
  walk(root);
  return files;
}
export function printSizeReport(root) {
  const files = siteFiles(root);
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  const largest = files.reduce((a, b) => a.bytes >= b.bytes ? a : b, { file: '', bytes: 0 });
  console.log(`${root}: ${total} bytes (${(total / 1_000_000).toFixed(2)} MB), ${files.length} files; largest ${largest.file}: ${largest.bytes} bytes (${(largest.bytes / 1_000_000).toFixed(2)} MB)`);
  return { total, count: files.length, largest };
}
