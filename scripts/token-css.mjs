// AUTHORED-BY Codex GPT-6.1-Sol
/** Parse declaration blocks independently, preserving source order and CSS escaped dots. */
export function declarations(body) {
  return Object.fromEntries(
    [...body.matchAll(/(--[\w.\\-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
      name.replaceAll("\\.", "."),
      value.trim(),
    ]),
  );
}
export function parseTokens(css) {
  const light = declarations(css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "");
  const dark = { ...light, ...declarations(css.match(/\.dark\s*\{([^}]+)\}/)?.[1] ?? "") };
  if (Object.keys(light).length === 0) throw new Error("Missing root token block");
  return { light, dark };
}

/** CSS formatters canonicalise trailing decimal zeroes without changing values. */
export function normalizeCssValue(value) {
  return value.replace(/\b\d+\.\d+\b/g, (number) => String(Number(number)));
}
