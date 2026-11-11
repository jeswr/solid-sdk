// AUTHORED-BY Codex (GPT-6.1 Sol)
import { isRenderable, sceneBounds } from "./geometry.js";
import { validateScene } from "./parse.js";
import type { Scene, SceneElement } from "./types.js";
export function escapeXml(value: string): string {
  return Array.from(value, (c) => {
    const code = c.codePointAt(0) ?? 0;
    return (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff ? "\ufffd" : c;
  })
    .join("")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
    )
    .split("")
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n >= 32 || n === 9 || n === 10 || n === 13;
    })
    .join("");
}
function elementSvg(e: SceneElement): string {
  const fill = escapeXml(e.backgroundColor),
    stroke = escapeXml(e.strokeColor);
  const attrs = `stroke="${stroke}" fill="${fill}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${e.strokeStyle === "dashed" ? ' stroke-dasharray="8 6"' : e.strokeStyle === "dotted" ? ' stroke-dasharray="2 5"' : ""}`;
  let body = "";
  if (e.type === "rectangle") body = `<rect width="${e.width}" height="${e.height}" ${attrs}/>`;
  else if (e.type === "ellipse")
    body = `<ellipse cx="${e.width / 2}" cy="${e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" ${attrs}/>`;
  else if (e.type === "diamond")
    body = `<polygon points="${e.width / 2},0 ${e.width},${e.height / 2} ${e.width / 2},${e.height} 0,${e.height / 2}" ${attrs}/>`;
  else if (e.type === "text") {
    const font = e.fontSize ?? 24;
    const lineHeight =
      typeof e.lineHeight === "number" && e.lineHeight > 0 && e.lineHeight < 10
        ? e.lineHeight
        : 1.25;
    const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
    const x = anchor === "middle" ? e.width / 2 : anchor === "end" ? e.width : 0;
    body = `<text fill="${stroke}" font-family="sans-serif" font-size="${font}" text-anchor="${anchor}" xml:space="preserve">${(
      e.text ?? ""
    )
      .split("\n")
      .map(
        (row, i) => `<tspan x="${x}" y="${font + i * font * lineHeight}">${escapeXml(row)}</tspan>`,
      )
      .join("")}</text>`;
  } else if (e.points) {
    body = `<polyline points="${e.points.map((p) => p.join(",")).join(" ")}" ${attrs} fill-opacity="0"/>`;
    if (e.type === "arrow" && e.points.length > 1 && e.endArrowhead !== null) {
      const b = e.points.at(-1),
        a = e.points.at(-2);
      if (a && b) {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const length = Math.max(12, e.strokeWidth * 4);
        body += `<polyline points="${b[0] - length * Math.cos(angle - 0.45)},${b[1] - length * Math.sin(angle - 0.45)} ${b.join(",")} ${b[0] - length * Math.cos(angle + 0.45)},${b[1] - length * Math.sin(angle + 0.45)}" ${attrs} fill-opacity="0"/>`;
      }
    }
  }
  return `<g opacity="${e.opacity / 100}" transform="translate(${e.x} ${e.y}) rotate(${(e.angle * 180) / Math.PI} ${e.width / 2} ${e.height / 2})">${body}</g>`;
}
export function sceneToSvgContent(scene: Scene): string {
  validateScene(scene);
  return scene.elements.filter(isRenderable).map(elementSvg).join("");
}
/** Export contains no external URLs, embedded files, foreignObject, styles or executable markup. */
export function sceneToSvg(
  scene: Scene,
  options: { padding?: number; background?: boolean } = {},
): string {
  validateScene(scene);
  const b = sceneBounds(scene),
    padding = options.padding ?? 24;
  if (!Number.isFinite(padding) || padding < 0 || padding > 10000)
    throw new TypeError("Invalid SVG padding");
  const width = Math.max(1, b.width + padding * 2),
    height = Math.max(1, b.height + padding * 2),
    x = b.x - padding,
    y = b.y - padding;
  const background =
    options.background && scene.appState.viewBackgroundColor
      ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(scene.appState.viewBackgroundColor)}"/>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Drawing">${background}${scene.elements.filter(isRenderable).map(elementSvg).join("")}</svg>`;
}
