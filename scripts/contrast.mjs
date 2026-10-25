// AUTHORED-BY Codex GPT-6.1-Sol
// OKLab inverse matrices: https://www.w3.org/TR/css-color-4/#color-conversion-code
// WCAG luminance/ratio: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
const clamp = (value) => Math.min(1, Math.max(0, value));
const encode = (value) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
const decode = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
export function oklchToSrgb(value) {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\)$/);
  if (!match) throw new Error(`Unsupported colour: ${value}`);
  const [, lv, cv, hv, av, percent] = match;
  const L = Number(lv),
    C = Number(cv),
    h = (Number(hv) * Math.PI) / 180;
  const a = C * Math.cos(h),
    b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  // Clip out-of-sRGB channels before encoding; no colour dependency or hidden gamut adjustment.
  return {
    rgb: [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((channel) => encode(clamp(channel))),
    alpha: av === undefined ? 1 : Number(av) / (percent ? 100 : 1),
  };
}
export function contrast(foreground, background) {
  const fg = oklchToSrgb(foreground),
    bg = oklchToSrgb(background);
  if (bg.alpha !== 1) throw new Error("Contrast background must be opaque");
  // CSS source-over compositing is in encoded sRGB, before luminance linearisation.
  const rgb = fg.rgb.map((channel, i) => channel * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
  const luminance = (channels) =>
    channels.map(decode).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const f = luminance(rgb),
    b = luminance(bg.rgb);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}
export function documentedPairs(values) {
  const pairs = [];
  const add = (fg, bg, minimum = 4.5) => {
    if (!pairs.some((p) => p.fg === fg && p.bg === bg)) pairs.push({ fg, bg, minimum });
  };
  for (const name of Object.keys(values)) {
    if (name.endsWith("-foreground") && Object.hasOwn(values, name.slice(0, -11)))
      add(name, name.slice(0, -11));
  }
  for (const bg of ["--background", "--surface", "--surface-2", "--surface-3"]) {
    for (const fg of ["--foreground", "--foreground-muted", "--foreground-subtle"])
      add(fg, bg, fg.endsWith("subtle") ? 3 : 4.5);
  }
  for (const bg of ["--background", "--surface"]) add("--primary", bg);
  add("--rail-foreground", "--rail");
  add("--ring", "--background", 3);
  add("--border-strong", "--background", 3);
  for (const name of Object.keys(values)) if (/^--app-[a-z]+$/.test(name)) add("--glyph", name, 3);
  return pairs;
}
export function contrastIssues(markdown) {
  return new Map(
    [
      ...markdown.matchAll(
        /<!-- contrast-issue: (light|dark)\|(--[\w-]+)\|(--[\w-]+)\|([\d.]+) -->/g,
      ),
    ].map(([, theme, fg, bg, ratio]) => [`${theme}|${fg}|${bg}`, Number(ratio)]),
  );
}
export function evaluateContrast(themes, known = new Map()) {
  return Object.entries(themes).flatMap(([theme, values]) =>
    documentedPairs(values).map((pair) => {
      const ratio = contrast(values[pair.fg], values[pair.bg]);
      const recorded = known.get(`${theme}|${pair.fg}|${pair.bg}`);
      return {
        theme,
        ...pair,
        ratio,
        status:
          ratio >= pair.minimum
            ? "PASS"
            : recorded !== undefined && Math.abs(recorded - ratio) < 0.005
              ? "KNOWN SPEC ISSUE"
              : "FAIL",
      };
    }),
  );
}
