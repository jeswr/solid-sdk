// AUTHORED-BY Codex GPT-6
const REDACTED = "[redacted]";

// Decode mixed, nested percent representations, including encoded unreserved
// characters. Malformed triplets do not hide adjacent valid ones.
function normalise(text: string): string {
  let out = text;
  for (let i = 0; i < 32; i++) {
    const next = out.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run.replace(/%([0-7][0-9a-f])/gi, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      }
    });
    if (next === out) return out;
    out = next;
  }
  // An excessively nested encoding is not safe to return to the planner.
  return REDACTED;
}

export function secretRedactor(secrets: ReadonlySet<string>): (text: string) => string {
  return (text) => {
    const decoded = normalise(text);
    let out = decoded;
    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
      out = out.split(secret).join(REDACTED);
      const normal = normalise(secret);
      if (normal) out = out.split(normal).join(REDACTED);
    }
    return out === decoded && decoded !== REDACTED ? text : out;
  };
}
