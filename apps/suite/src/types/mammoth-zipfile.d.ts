// AUTHORED-BY Codex
// Mammoth's browser-safe JSZip adapter; mammoth is pinned in package.json.
declare module "mammoth/mammoth.browser" {
  import mammoth from "mammoth";
  export = mammoth;
}
declare module "mammoth/lib/zipfile" {
  interface Archive {
    exists(name: string): boolean;
    read(name: string, encoding: "utf-8"): Promise<string>;
    write(name: string, contents: string): void;
    toArrayBuffer(): Promise<ArrayBuffer>;
  }
  export function openArrayBuffer(data: ArrayBuffer): Promise<Archive>;
}
declare module "mammoth/lib/zipfile.js" {
  export * from "mammoth/lib/zipfile";
}
