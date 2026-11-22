// AUTHORED-BY Codex GPT-6.1-Sol
// Run from any directory: node apps/suite/scripts/generate-pwa-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const publicDir = new URL("../public/", import.meta.url);
const destination = new URL("icons/", publicDir);
const source = await readFile(new URL("icon.svg", publicDir), "utf8");
const css = await readFile(
  new URL("../../../packages/suite-ui/src/styles/tokens.css", import.meta.url),
  "utf8",
);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style>${source}`);
  for (const [name, size, scale] of [
    ["icon-192.png", 192, 1],
    ["icon-512.png", 512, 1],
    // The source's furthest vertex is 17/40 from centre; scale .8 puts it within
    // the maskable safe circle (radius .4 of the canvas) with room to spare.
    ["icon-maskable-512.png", 512, 0.8],
    ["apple-touch-icon.png", 180, 0.8],
  ]) {
    const data = await page.evaluate(
      async ({ size, scale }) => {
        const svg = document.querySelector("svg").cloneNode(true);
        const styles = getComputedStyle(document.documentElement);
        svg.style.setProperty("--primary", styles.getPropertyValue("--primary"));
        svg.style.setProperty(
          "--primary-foreground",
          styles.getPropertyValue("--primary-foreground"),
        );
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = styles.getPropertyValue("--background");
        ctx.fillRect(0, 0, size, size);
        const padding = (size * (1 - scale)) / 2;
        ctx.drawImage(image, padding, padding, size * scale, size * scale);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { size, scale },
    );
    await writeFile(new URL(name, destination), Buffer.from(data, "base64"));
  }
  // The two source polygons form one ring; an even-odd path leaves a transparent
  // hole so the OS can tint the entire silhouette as a monochrome icon.
  const monochrome = await page.evaluate(() => {
    const svg = document.querySelector("svg").cloneNode(true);
    const paths = [...svg.querySelectorAll("path")];
    // Reset the current point before each source path: the inner path starts with
    // a relative move, whose origin would otherwise be the outer path's last point.
    paths[0].setAttribute("d", paths.map((path) => `M0 0 ${path.getAttribute("d")}`).join(" "));
    paths[0].setAttribute("fill", "currentColor");
    paths[0].setAttribute("fill-rule", "evenodd");
    for (const path of paths.slice(1)) path.remove();
    return new XMLSerializer().serializeToString(svg);
  });
  await writeFile(
    new URL("icon-monochrome.svg", destination),
    `<!-- AUTHORED-BY Codex GPT-6.1-Sol -->\n${monochrome}\n`,
  );
} finally {
  await browser.close();
}
