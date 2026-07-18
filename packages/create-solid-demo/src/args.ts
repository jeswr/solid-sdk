// AUTHORED-BY Claude Fable 5
/**
 * CLI argument parsing for create-solid-demo (§4.1 of the showcase-framework design).
 *
 * Every value flag supports both `--flag value` and `--flag=value`. Errors are
 * collected (not thrown) so a bad invocation reports every problem at once; the
 * bin decides whether missing required answers become prompts (TTY) or a usage
 * error (non-interactive).
 */
import { SLUG_PATTERN, toSlug } from "./names.js";

/** One `--app slug:name:role` registration. */
export interface AppSpec {
  slug: string;
  name: string;
  role: string;
}

export interface CliOptions {
  /** Target directory (the single positional). */
  targetDir?: string;
  /** `--use-case <slug>` → deploy.slug; derives the env + cookie prefixes. */
  useCase?: string;
  /** `--convener <name>` → branding.convener + site.organization. */
  convener?: string;
  /** `--negation <line>` (repeatable) → branding.domainNegations. */
  negations: string[];
  /** `--app slug:name:role` (repeatable, ≥1 required). */
  apps: AppSpec[];
  /** `--modelled-on slug=Org` (repeatable); defaults to the app's role text. */
  modelledOn: Record<string, string>;
  /** `--seed` — run the generated repo's seed script after install. */
  seed: boolean;
  /** `--no-install` clears this. */
  install: boolean;
  help: boolean;
  errors: string[];
}

/** Slugs the scaffolder owns; a caller-registered app must not collide. */
export const RESERVED_APP_SLUGS = new Set(["tour", "data-model", "seeds", "e2e"]);

/**
 * Parse `slug:name:role`. The name/role segments may contain further colons only
 * in the role (split on the first two), so `desk:Permit Desk:issuer: level two`
 * keeps "issuer: level two" as the role text.
 */
export function parseAppSpec(raw: string): AppSpec | string {
  const first = raw.indexOf(":");
  const second = first === -1 ? -1 : raw.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    return `--app expects slug:name:role, got: ${raw}`;
  }
  const slug = raw.slice(0, first).trim();
  const name = raw.slice(first + 1, second).trim();
  const role = raw.slice(second + 1).trim();
  if (!SLUG_PATTERN.test(slug)) {
    return `--app slug must match ${SLUG_PATTERN} (lowercase, digits, dashes), got: ${slug}`;
  }
  if (RESERVED_APP_SLUGS.has(slug)) {
    return `--app slug "${slug}" is reserved by the scaffold (one of: ${[...RESERVED_APP_SLUGS].join(", ")})`;
  }
  if (name.length === 0 || role.length === 0) {
    return `--app expects non-empty slug:name:role, got: ${raw}`;
  }
  return { name, role, slug };
}

/** Parse `slug=Org` for `--modelled-on`. */
function parseModelledOn(raw: string): [string, string] | string {
  const eq = raw.indexOf("=");
  if (eq === -1) return `--modelled-on expects slug=Organisation, got: ${raw}`;
  const slug = raw.slice(0, eq).trim();
  const org = raw.slice(eq + 1).trim();
  if (slug.length === 0 || org.length === 0) {
    return `--modelled-on expects non-empty slug=Organisation, got: ${raw}`;
  }
  return [slug, org];
}

const VALUE_FLAGS = new Set(["--use-case", "--convener", "--negation", "--app", "--modelled-on"]);

export function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    apps: [],
    errors: [],
    help: false,
    install: true,
    modelledOn: {},
    negations: [],
    seed: false,
  };

  /** Route one `--flag value` pair into `out`. */
  const applyValue = (flag: string, value: string): void => {
    if (value.trim().length === 0) {
      out.errors.push(`${flag} requires a non-empty value`);
      return;
    }
    switch (flag) {
      case "--use-case": {
        const slug = toSlug(value);
        if (slug === undefined) {
          out.errors.push(`--use-case must be a lowercase slug (a-z, 0-9, dashes), got: ${value}`);
        } else {
          out.useCase = slug;
        }
        break;
      }
      case "--convener":
        out.convener = value.trim();
        break;
      case "--negation":
        out.negations.push(value.trim());
        break;
      case "--app": {
        const spec = parseAppSpec(value);
        if (typeof spec === "string") out.errors.push(spec);
        else if (out.apps.some((existing) => existing.slug === spec.slug)) {
          out.errors.push(`--app slug "${spec.slug}" was given more than once`);
        } else out.apps.push(spec);
        break;
      }
      case "--modelled-on": {
        const pair = parseModelledOn(value);
        if (typeof pair === "string") out.errors.push(pair);
        else out.modelledOn[pair[0]] = pair[1];
        break;
      }
      default:
        out.errors.push(`unknown flag: ${flag}`);
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--no-install") out.install = false;
    else if (arg === "--seed") out.seed = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        out.errors.push(`${arg} requires a value`);
      } else {
        applyValue(arg, value);
        i++;
      }
    } else if (arg.includes("=") && VALUE_FLAGS.has(arg.slice(0, arg.indexOf("=")))) {
      applyValue(arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1));
    } else if (arg.startsWith("-")) {
      out.errors.push(`unknown flag: ${arg}`);
    } else if (out.targetDir === undefined) {
      out.targetDir = arg;
    } else {
      out.errors.push(`unexpected extra argument: ${arg} (only one target directory is allowed)`);
    }
  }

  for (const slug of Object.keys(out.modelledOn)) {
    if (!out.apps.some((app) => app.slug === slug)) {
      out.errors.push(`--modelled-on names unknown app slug "${slug}" (register it with --app)`);
    }
  }

  return out;
}
