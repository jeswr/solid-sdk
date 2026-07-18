// AUTHORED-BY Claude Fable 5
/**
 * Interactive mode (§4.1): asks EXACTLY the flag set — use-case, convener,
 * negations (≥1), apps (≥1, slug:name:role) and per-app modelled-on — nothing
 * more. Every answer lands in the generated walkthrough.json, the single edit
 * surface afterwards. Non-TTY invocations never prompt: the bin reports the
 * missing flags as a usage error instead.
 */
import type { Interface } from "node:readline/promises";
import { type CliOptions, parseAppSpec } from "./args.js";
import { toSlug } from "./names.js";

async function askRequired(
  rl: Interface,
  question: string,
  validate: (raw: string) => string | undefined,
): Promise<string> {
  for (;;) {
    const raw = (await rl.question(question)).trim();
    if (raw.length === 0) {
      rl.write("  (required)\n");
      continue;
    }
    const error = validate(raw);
    if (error === undefined) return raw;
    rl.write(`  ✗ ${error}\n`);
  }
}

/** Fill every missing required answer in place. The caller owns the readline. */
export async function promptMissing(options: CliOptions, rl: Interface): Promise<void> {
  if (options.useCase === undefined) {
    const raw = await askRequired(rl, "Use-case slug (e.g. trails): ", (value) =>
      toSlug(value) === undefined ? "must be a lowercase slug (a-z, 0-9, dashes)" : undefined,
    );
    options.useCase = toSlug(raw) as string;
  }

  if (options.convener === undefined) {
    options.convener = await askRequired(
      rl,
      "Convener (the organisation publishing the walkthrough): ",
      () => undefined,
    );
  }

  while (options.negations.length === 0) {
    const first = await askRequired(
      rl,
      'Domain negation (a full sentence, e.g. "Nothing here is an offer of guided travel."): ',
      () => undefined,
    );
    options.negations.push(first);
    for (;;) {
      const more = (await rl.question("Another negation (blank to finish): ")).trim();
      if (more.length === 0) break;
      options.negations.push(more);
    }
  }

  while (options.apps.length === 0) {
    rl.write("Register at least one app (the FIRST is the data subject's own custodian seat).\n");
    for (;;) {
      const label =
        options.apps.length === 0 ? "App (slug:name:role): " : "Another app (blank to finish): ";
      const raw = (await rl.question(label)).trim();
      if (raw.length === 0) {
        if (options.apps.length > 0) break;
        rl.write("  (at least one app is required)\n");
        continue;
      }
      const spec = parseAppSpec(raw);
      if (typeof spec === "string") {
        rl.write(`  ✗ ${spec}\n`);
        continue;
      }
      if (options.apps.some((existing) => existing.slug === spec.slug)) {
        rl.write(`  ✗ slug "${spec.slug}" already registered\n`);
        continue;
      }
      options.apps.push(spec);
      const modelled = (
        await rl.question(`  Modelled on (organisation; blank = "${spec.role}"): `)
      ).trim();
      if (modelled.length > 0) options.modelledOn[spec.slug] = modelled;
    }
  }
}
