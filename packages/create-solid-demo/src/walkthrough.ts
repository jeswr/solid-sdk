// AUTHORED-BY Claude Fable 5
/**
 * Build the generated repo's starter `walkthrough.json` (§4.1/§4.2): one placeholder
 * chapter per registered app, already passing `parseWalkthrough` and the editorial
 * gates, so the site renders end-to-end before any real content is written.
 *
 * DOMAIN-GENERIC BY CONSTRUCTION: nothing here carries any use case — every
 * domain-shaped string (use-case slug, convener, negations, app names/roles,
 * modelled-on organisations) is caller input. `branding.bannedMarks` starts EMPTY:
 * the kit ships no built-in insignia roster, so the consumer supplies their own
 * domain's never-render marks in the document (see the generated
 * `scripts/check-insignia.mjs`).
 */
import type { WalkthroughDocument } from "@jeswr/solid-showcase";
import type { AppSpec } from "./args.js";
import { toEnvPrefix, toTitleWords, toWords } from "./names.js";

/** Everything the walkthrough + scaffold need to know (post-prompt, validated). */
export interface DemoSpec {
  useCase: string;
  convener: string;
  negations: string[];
  apps: AppSpec[];
  /** Per-app-slug modelled-on organisation; absent = the app's role text. */
  modelledOn: Record<string, string>;
}

export function envPrefixFor(spec: DemoSpec): string {
  return toEnvPrefix(spec.useCase);
}

export function modelledOnFor(spec: DemoSpec, app: AppSpec): string {
  return spec.modelledOn[app.slug] ?? app.role;
}

export function zoneEnvFor(spec: DemoSpec, app: AppSpec): string {
  return `${envPrefixFor(spec)}_${toEnvPrefix(app.slug)}_ZONE_URL`;
}

/** Original, palette-inspired placeholder hues — golden-angle rotation, never brand colours. */
function themeFor(index: number, role: string) {
  const hue = (210 + index * 137) % 360;
  const accentHue = (hue + 40) % 360;
  return {
    accent: `oklch(0.72 0.11 ${accentHue})`,
    hue,
    primary: `oklch(0.45 0.09 ${hue})`,
    role,
  };
}

function chapterFor(app: AppSpec, scene: number) {
  return {
    anchor: `Placeholder anchor — cite the public rule or industry fact that scene ${scene} dramatizes.`,
    lead: `${app.name} holds the ${app.role} seat in this walkthrough. This placeholder chapter marks where it sits in the journey — replace it with the real scene.`,
    scene,
    slug: `meet-the-${app.slug}`,
    steps: [
      {
        body: `A placeholder step. Describe what the visitor sees when ${app.name} reads from the data subject's pod — and what never leaves the pod owner's control.`,
        title: `Open ${app.name}`,
        tryLive: { app: app.slug, label: `Open ${app.name}` },
      },
      {
        body: "Every word of this site renders from apps/tour/content/walkthrough.json. Replace this step with the scene's second beat — the write, the grant, or the receipt it demonstrates.",
        title: "Edit this chapter",
        tryLive: { app: app.slug, label: `Back to ${app.name}` },
      },
    ],
    title: `Meet ${app.name}`,
  };
}

/**
 * The starter document. The FIRST registered app is treated as the data subject's
 * own custodian seat (the ecosystem centre); every app gets one placeholder chapter.
 */
export function buildWalkthrough(spec: DemoSpec): WalkthroughDocument {
  const envPrefix = envPrefixFor(spec);
  const title = toTitleWords(spec.useCase);
  const words = toWords(spec.useCase);
  const appName = `${title} Walkthrough`;

  const apps: WalkthroughDocument["registry"]["apps"] = {
    tour: {
      appName,
      healthPath: "/api/health",
      modelledOn: spec.convener,
      path: "/",
      slug: "tour",
      theme: {
        accent: "oklch(0.72 0.1 250)",
        hue: 210,
        primary: "oklch(0.42 0.08 210)",
        role: "walkthrough shell",
      },
    },
  };
  for (const [index, app] of spec.apps.entries()) {
    apps[app.slug] = {
      appName: app.name,
      healthPath: `/${app.slug}/api/health`,
      honesty: {
        real: [
          "Serves an authenticated pod route guarded by @jeswr/solid-pod-guard (fails closed until an operator configures it)",
        ],
        simulated: ["Every decision and record in this placeholder app is scripted demo content"],
      },
      modelledOn: modelledOnFor(spec, app),
      path: `/${app.slug}`,
      podRoutes: ["/api/pod/example"],
      slug: app.slug,
      theme: themeFor(index, app.role),
      zoneEnv: zoneEnvFor(spec, app),
    };
  }

  const centerApp = spec.apps[0] as AppSpec;
  const roles: WalkthroughDocument["registry"]["roles"] = [
    {
      apps: [centerApp.slug],
      center: true,
      membership: "The data subject — the centre of the ecosystem",
      modelledOn: modelledOnFor(spec, centerApp),
      role: centerApp.role,
      slug: "data-subject",
      summary: `Holds the journey's records in a pod only the data subject controls, granting each party scoped, revocable access. Placeholder — describe your ${words} data subject.`,
    },
  ];
  for (const [index, app] of spec.apps.slice(1).entries()) {
    roles.push({
      apps: [app.slug],
      membership: "Placeholder — state this seat's honest recruitment framing",
      modelledOn: modelledOnFor(spec, app),
      role: app.role,
      roleNumber: index + 1,
      scene: index + 2,
      slug: `${app.slug}-seat`,
      summary: `Placeholder — one sentence on what the ${app.name} seat does with pod data, and what it never retains.`,
    });
  }

  return {
    anchors: [],
    branding: {
      aboutHref: "/",
      // The kit ships NO built-in banned-marks roster — add your domain's
      // never-render marks (regulatory insignia, third-party product marks) here.
      bannedMarks: [],
      convener: spec.convener,
      description: `show how a multi-party ${words} journey could run on personal data stores`,
      domainNegations: [...spec.negations],
    },
    chapters: spec.apps.map((app, index) => chapterFor(app, index + 1)),
    deploy: {
      envPrefix,
      slug: spec.useCase,
    },
    persona: {
      descriptor: "Fictional persona — every value is simulated.",
      fields: [
        { label: "Name", value: "Alex Sample" },
        {
          label: "Identifier",
          note: "Issued by the seed script (seeds/persona.ts)",
          value: "AS-0001",
        },
        { copyable: false, label: "Pod", value: "Provisioned by pnpm run seed" },
      ],
      footnote:
        "Keep these values in sync with seeds/persona.ts — the seeded pod data must match this card.",
      name: "Alex Sample",
    },
    registry: {
      apps,
      center: "data-subject",
      launcherOrder: ["tour", ...spec.apps.map((app) => app.slug)],
      roles,
    },
    site: {
      appName,
      exploreCtaLabel: "Explore the ecosystem",
      heroLead: "Data subjects hold their own records. Every party gets scoped, revocable access.",
      heroParagraph: `This is a freshly scaffolded ${words} walkthrough. Each chapter below is a placeholder that renders end-to-end before any real content is written: edit apps/tour/content/walkthrough.json — the single document that drives the landing page, the ecosystem map, the launcher, and every chapter — and the site follows.`,
      heroTitle: "One journey, many parties, one pod",
      organization: spec.convener,
      startCtaLabel: "Start the walkthrough",
    },
    version: 1,
  };
}

/** One row of the generated docs/deploy.md env matrix. */
export interface EnvMatrixRow {
  name: string;
  project: string;
  value: string;
  purpose: string;
}

/**
 * The initial env matrix for docs/deploy.md. Regenerate later from the document via
 * `envMatrix(doc)` in `@jeswr/solid-showcase/next` — the rules are the same: zone-URL
 * vars are read at BUILD time by the shell's rewrites; every app with an authenticated
 * pod route needs the forwarded-headers trust var behind a TLS-terminating proxy, plus
 * the pod-guard issuer/origin allowlists (which fail closed while unset).
 */
export function envMatrixRows(spec: DemoSpec): EnvMatrixRow[] {
  const prefix = envPrefixFor(spec);
  const rows: EnvMatrixRow[] = [];
  for (const app of spec.apps) {
    rows.push({
      name: zoneEnvFor(spec, app),
      project: "tour (shell)",
      purpose: `Production URL of ${app.name}, no trailing slash — read at BUILD time by the shell's zone rewrites.`,
      value: "https://…",
    });
  }
  const appProjects = spec.apps.map((app) => app.slug).join(", ");
  rows.push(
    {
      name: `${prefix}_TRUST_FORWARDED_HEADERS`,
      project: appProjects,
      purpose:
        "Trust proxy-forwarded host headers on authenticated pod routes; without it the proof-bound request URL is computed from the internal host and every authenticated call is rejected.",
      value: "1",
    },
    {
      name: `${prefix}_TRUSTED_OIDC_ISSUERS`,
      project: appProjects,
      purpose:
        "Comma-separated Solid-OIDC issuers trusted to mint caller tokens. The pod-guard rail fails closed (503) while unset.",
      value: "https://…",
    },
    {
      name: `${prefix}_POD_ALLOWED_ORIGINS`,
      project: appProjects,
      purpose:
        "Comma-separated pod ORIGINS server-side pod IO may touch (SSRF allowlist). Fails closed while unset.",
      value: "https://…",
    },
  );
  return rows;
}
