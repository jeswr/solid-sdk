// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import {
  copyTemplateImages,
  relocateAttributes,
  TemplateImageError,
  templatePreview,
} from "../src/index.js";

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
  const copied = await copyTemplateImages(json, {
    root,
    copyable: () => true,
    outside: "refuse",
    read,
    upload,
  });
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
      copyable: () => true,
      outside: "keep",
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
      copyable: () => true,
      outside: "keep",
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
      copyable: () => true,
      outside: "refuse",
      read: async () => ({ data: new ArrayBuffer(1), contentType: "image/png" }),
      upload: async () => target,
    },
  );
  expect(JSON.stringify(copied).match(/templates\/copy/g)).toHaveLength(3);
  expect(JSON.stringify(copied)).not.toContain("assets/image.png");
});
it("never fetches in-pod images it may not copy: keeps them on save, refuses them on use", async () => {
  const assets = `${root}docs/source/assets/`;
  const own = `${assets}own.png`;
  const foreign = `${root}photos/private.jpg`;
  const json = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: own } },
      { type: "image", attrs: { src: foreign } },
    ],
  };
  const read = vi.fn(async () => ({ data: new ArrayBuffer(1), contentType: "image/png" }));
  const copyable = (url: string) => url.startsWith(assets);
  const copied = await copyTemplateImages(json, {
    root,
    copyable,
    outside: "keep",
    read,
    upload: async () => `${root}templates/copy`,
  });
  expect(read).toHaveBeenCalledExactlyOnceWith(own);
  expect(JSON.stringify(copied)).toContain(`"src":"${foreign}"`);
  expect(JSON.stringify(copied)).toContain(`"src":"${root}templates/copy"`);
  read.mockClear();
  const refused = copyTemplateImages(json, {
    root,
    copyable,
    outside: "refuse",
    read,
    upload: async () => "unused",
  });
  await expect(refused).rejects.toBeInstanceOf(TemplateImageError);
  await expect(refused).rejects.toThrow("outside your templates folder");
  expect(read).not.toHaveBeenCalled();
});
it("skips missing images and non-image media, keeping their references", async () => {
  const missing = `${root}docs/a/assets/missing.png`;
  const page = `${root}docs/a/assets/page.html`;
  const photo = `${root}docs/a/assets/photo.jpg`;
  const upload = vi.fn(async (_data: ArrayBuffer, type: string) => `${root}templates/${type}`);
  const copied = await copyTemplateImages(
    {
      type: "doc",
      content: [missing, page, photo].map((src) => ({ type: "image", attrs: { src } })),
    },
    {
      root,
      copyable: () => true,
      outside: "keep",
      read: async (url) =>
        url === missing
          ? undefined
          : {
              data: new ArrayBuffer(1),
              contentType: url === page ? "text/html" : "IMAGE/JPEG; charset=binary",
            },
      upload,
    },
  );
  expect(upload).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), "image/jpeg");
  expect(JSON.stringify(copied)).toContain(missing);
  expect(JSON.stringify(copied)).toContain(page);
  expect(JSON.stringify(copied)).not.toContain(photo);
});
