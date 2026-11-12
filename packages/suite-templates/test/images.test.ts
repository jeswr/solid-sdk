// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { copyTemplateImages, relocateAttributes, templatePreview } from "../src/index.js";

const root = "https://pod.example/alice/";
it("copies each in-pod image once and relocates image attributes and links without changing text", async () => {
  const source = `${root}docs/source/assets/image.png`;
  const target = `${root}templates/snapshot.asset.png`;
  const json = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: source } },
      { type: "image", attrs: { src: source, alt: source } },
      { type: "image", attrs: { src: "https://foreign.example/image.png" } },
      { type: "image", attrs: {} },
      { type: "text", text: source, marks: [{ attrs: { href: source, "data-images": [source] } }] },
      { type: "paragraph", content: [null, 1] },
    ],
  };
  const data = new ArrayBuffer(3);
  const read = vi.fn(async () => ({ data, contentType: "image/png" }));
  const upload = vi.fn(async () => target);
  const copied = await copyTemplateImages(json, { root, read, upload });
  expect(read).toHaveBeenCalledExactlyOnceWith(source);
  expect(upload).toHaveBeenCalledExactlyOnceWith(data, "image/png");
  expect(JSON.stringify(copied)).toContain(`"src":"${target}"`);
  expect(JSON.stringify(copied)).toContain(`"href":"${target}"`);
  expect(JSON.stringify(copied)).toContain(`"data-images":["${target}"]`);
  expect(JSON.stringify(copied)).toContain(`"text":"${source}"`);
  expect(JSON.stringify(copied)).toContain(`"alt":"${source}"`);
  expect(json.content[0]?.attrs?.src).toBe(source);
  expect(relocateAttributes(null, () => "unused")).toBeNull();
});
it("fails rather than retaining a broken source URL if an image cannot be copied", async () => {
  const json = { type: "image", attrs: { src: `${root}docs/deleted/assets/a.png` } };
  const upload = vi.fn();
  await expect(
    copyTemplateImages(json, {
      root,
      read: async () => {
        throw new Error("deleted");
      },
      upload,
    }),
  ).rejects.toThrow("deleted");
  expect(upload).not.toHaveBeenCalled();
  await expect(
    copyTemplateImages(json, {
      root,
      read: async () => ({ data: new ArrayBuffer(0), contentType: "image/png" }),
      upload: async () => {
        throw new Error("upload failed");
      },
    }),
  ).rejects.toThrow("upload failed");
});
it("derives a short plain-text preview from the caller's text", () => {
  expect(templatePreview("  First\n\n second\t third  ")).toBe("First second third");
  expect(templatePreview("a".repeat(200))).toHaveLength(160);
  expect(templatePreview("")).toBe("");
});
// AUTHORED-BY Claude Opus 5.5 (test below)
it("relocates equivalent spellings of a copied image URL", async () => {
  const source = `${root}docs/source/assets/image.png`;
  const target = `${root}templates/copy`;
  const copied = await copyTemplateImages(
    {
      type: "doc",
      content: [
        { type: "image", attrs: { src: `${root}docs/./source/assets/image.png` } },
        { type: "image", attrs: { src: "docs/source/assets/image.png" } },
        { type: "text", marks: [{ attrs: { href: source } }] },
      ],
    },
    {
      root,
      read: async () => ({ data: new ArrayBuffer(1), contentType: "image/png" }),
      upload: async () => target,
    },
  );
  expect(JSON.stringify(copied).match(/templates\/copy/g)).toHaveLength(3);
  expect(JSON.stringify(copied)).not.toContain("assets/image.png");
});
