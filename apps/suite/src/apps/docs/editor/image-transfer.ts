// AUTHORED-BY Codex
export interface RichImageTransfer {
  fragment: HTMLTemplateElement;
  images: { file: File; elements: HTMLImageElement[]; alt: string }[];
}

function dataImage(source: string): File {
  const comma = source.indexOf(",");
  const [type, ...parameters] = source.slice(5, comma).split(";");
  if (comma < 0 || !type?.toLowerCase().startsWith("image/")) throw new Error();
  const data = decodeURIComponent(source.slice(comma + 1));
  const bytes = parameters.some((parameter) => parameter.toLowerCase() === "base64")
    ? Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(data);
  return new File([bytes], "pasted-image", { type: type.toLowerCase() });
}

/** Text wins over a screenshot fallback, but local images inside HTML need their own uploads.
 * Keep the fragment inert until every uploaded src is a pod URL; never fetch local URLs. */
export function imageTransfer(
  transfer: DataTransfer | null,
): { file: File; rich?: RichImageTransfer } | undefined {
  const files = [...(transfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  const html = transfer?.getData("text/html");
  if (html) {
    const fragment = document.createElement("template");
    fragment.innerHTML = html;
    const images: RichImageTransfer["images"] = [];
    const sources = new Map<string, File>();
    const used = new Set<File>();
    for (const element of fragment.content.querySelectorAll<HTMLImageElement>("img[src]")) {
      const source = (element.getAttribute("src") ?? "").trim();
      if (!/^(data|file|blob):/i.test(source)) continue;
      let file = sources.get(source);
      if (!file) {
        if (/^data:/i.test(source)) file = dataImage(source);
        else {
          const name = decodeURIComponent(source.slice(source.lastIndexOf("/") + 1));
          file = files.find((item) => !used.has(item) && item.name === name);
          file ??= files.find((item) => !used.has(item));
        }
        if (!file) throw new Error("Embedded image bytes are missing");
        sources.set(source, file);
        used.add(file);
      }
      const alt = element.getAttribute("alt") ?? "";
      const existing = images.find((image) => image.file === file && image.alt === alt);
      if (existing) existing.elements.push(element);
      else images.push({ file, elements: [element], alt });
    }
    const file = images[0]?.file;
    return file ? { file, rich: { fragment, images } } : undefined;
  }
  if (transfer?.getData("text/plain")) return undefined;
  const file = files[0];
  return file ? { file } : undefined;
}
