// AUTHORED-BY Codex
import type { JSONContent } from "@tiptap/react";
import { type Document, Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { validLink } from "../editor/logic";
import { descendants, readXml, type XmlElement } from "./docx-xml";
import { importSchema, normaliseImport } from "./schema";

export const PAYLOAD_PROPERTY = "SuiteDocsDocument";
const CUSTOM = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
type Archive = Awaited<ReturnType<typeof openArrayBuffer>>;

async function digest(value: string | Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visibleText(node: XmlElement): string {
  if (node.name === "t") return node.text;
  if (node.name === "tab") return "\t";
  if (node.name === "br") return "\n";
  return node.children.map(visibleText).join("") + (node.name === "p" ? "\n" : "");
}

async function fingerprints(archive: Archive) {
  const body = await archive.read("word/document.xml", "utf-8");
  // Text detects content edits. These parts also detect formatting, numbering and link edits.
  const parts = await Promise.all(
    ["word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"].map(async (name) =>
      archive.exists(name) ? archive.read(name, "utf-8") : "",
    ),
  );
  const relationships = readXml(parts[2] || "<Relationships/>");
  const media = await Promise.all(
    descendants(
      relationships,
      "http://schemas.openxmlformats.org/package/2006/relationships:Relationship",
    )
      .filter((relationship) => relationship.attrs[":Target"]?.startsWith("media/"))
      .map(async (relationship) =>
        digest(await archive.read(`word/${relationship.attrs[":Target"]}`)),
      ),
  );
  return {
    textDigest: await digest(visibleText(readXml(body))),
    bodyDigest: await digest(JSON.stringify([body, ...parts, ...media])),
  };
}

/** Validate without repairing: an embedded document must be entirely understood by this schema. */
function validated(json: JSONContent) {
  const parsed = importSchema.nodeFromJSON(json);
  parsed.check();
  const normalised = normaliseImport(json);
  if (
    normalised.skipped.length ||
    parsed.type.name !== "doc" ||
    JSON.stringify(parsed.toJSON()) !== JSON.stringify(normalised.json)
  )
    throw new Error("Invalid embedded document");
  parsed.descendants((node) => {
    if (
      node.type.name === "image" &&
      (!validLink(String(node.attrs.src)) || !/^https?:/.test(String(node.attrs.src)))
    )
      throw new Error("Unsafe embedded image");
    for (const mark of node.marks) {
      if (mark.type.name === "link" && !validLink(String(mark.attrs.href)))
        throw new Error("Unsafe embedded link");
    }
  });
  return normalised.json;
}

export async function embedDocument(document: Document, json: JSONContent) {
  const archive = await openArrayBuffer(await Packer.toArrayBuffer(document));
  document.CustomProperties.addCustomProperty({
    name: PAYLOAD_PROPERTY,
    value: JSON.stringify({ version: 1, ...(await fingerprints(archive)), json }),
  });
}

/** Missing, damaged, stale or incompatible payloads always fall back to visible DOCX content. */
export async function embeddedDocument(archive: Archive): Promise<JSONContent | undefined> {
  if (!archive.exists("docProps/custom.xml")) return undefined;
  try {
    const properties = readXml(await archive.read("docProps/custom.xml", "utf-8"));
    const values = descendants(properties, `${CUSTOM}:property`)
      .filter((property) => property.attrs[":name"] === PAYLOAD_PROPERTY)
      .flatMap((property) => descendants(property, `${VT}:lpwstr`));
    if (values.length !== 1) return undefined;
    const payload = JSON.parse((values[0] as XmlElement).text);
    if (payload.version !== 1) return undefined;
    const current = await fingerprints(archive);
    if (payload.textDigest !== current.textDigest || payload.bodyDigest !== current.bodyDigest)
      return undefined;
    return validated(payload.json);
  } catch {
    return undefined;
  }
}
