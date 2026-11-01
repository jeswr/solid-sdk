// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { type ReadExportImage, toDocx } from "../../src/apps/docs/lib/convert/docx-export";
import { descendants, readXml, type XmlElement } from "../../src/apps/docs/lib/convert/docx-xml";

/** Construct the retired export format explicitly, solely for legacy-import regressions. */
export async function legacyDocx(json: JSONContent, readImage: ReadExportImage) {
  const document = await toDocx(json, readImage);
  const archive = await openArrayBuffer(await Packer.toArrayBuffer(document));
  const body = await archive.read("word/document.xml", "utf-8");
  const parts = await Promise.all(
    ["word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"].map((name) =>
      archive.read(name, "utf-8"),
    ),
  );
  const relationships = descendants(
    readXml(parts[2] as string),
    "http://schemas.openxmlformats.org/package/2006/relationships:Relationship",
  );
  const media = await Promise.all(
    relationships
      .filter((relationship) => relationship.attrs[":Target"]?.startsWith("media/"))
      .map(async (relationship) =>
        digest(await archive.read(`word/${relationship.attrs[":Target"]}`)),
      ),
  );
  const images = descendants(
    readXml(body),
    "http://schemas.openxmlformats.org/drawingml/2006/main:blip",
  )
    .map((blip) =>
      relationships.find(
        (relationship) =>
          relationship.attrs[":Id"] ===
          blip.attrs["http://schemas.openxmlformats.org/officeDocument/2006/relationships:embed"],
      ),
    )
    .map((relationship) => `word/${relationship?.attrs[":Target"]}`);
  document.CustomProperties.addCustomProperty({
    name: "SuiteDocsDocument",
    value: JSON.stringify({
      version: 1,
      textDigest: await digest(visibleText(readXml(body))),
      bodyDigest: await digest(JSON.stringify([body, ...parts, ...media])),
      images,
      json,
    }),
  });
  return document;
}

async function digest(value: string | Uint8Array<ArrayBuffer>) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visibleText(node: XmlElement): string {
  if (node.name === "t") return node.text;
  if (node.name === "tab") return "\t";
  if (node.name === "br") return "\n";
  return node.children.map(visibleText).join("") + (node.name === "p" ? "\n" : "");
}
