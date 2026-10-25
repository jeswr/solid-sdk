// AUTHORED-BY Codex GPT-6.1-Sol
/** Validate a complete HTTP(S) URL and display its hostname as ASCII punycode. */
export function parseAutolink(value: string): { href: string; label: string } | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before URL normalisation can silently remove them.
  if (!/^https?:\/\//i.test(value) || /[\s\\<>"'\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return { href: url.href, label: url.href };
  } catch {
    return null;
  }
}

/** Remove sentence punctuation and unmatched closing brackets, retaining balanced URL paths. */
export function trimLinkEnd(value: string): string {
  let result = value.replace(/[.,!?;:]+$/, "");
  while (/[)\]}]$/.test(result)) {
    const close = result.slice(-1);
    const open = { ")": "(", "]": "[", "}": "{" }[close] as string;
    if (result.split(close).length <= result.split(open).length) break;
    result = result.slice(0, -1).replace(/[.,!?;:]+$/, "");
  }
  return result;
}
