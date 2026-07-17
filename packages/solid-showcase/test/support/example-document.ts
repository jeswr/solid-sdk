// AUTHORED-BY Claude Fable 5
/**
 * A wholly FICTIONAL, domain-generic walkthrough document: a multi-party trail-expedition
 * journey over personal data stores. Every organisation, rule, and value here is invented
 * for the test fixture — this package never embeds any real use case's content; real
 * walkthroughs live with their consumers.
 */
import type { WalkthroughDocument } from "../../src/schema.js";

export const exampleWalkthrough: WalkthroughDocument = {
  anchors: [
    {
      detail:
        "The same traveller facts are re-collected by every desk in a typical multi-party expedition, per the fictional journeys dataset.",
      id: "copies",
      label: "times the same records are re-collected per journey",
      source: { name: "Example journeys dataset", url: "https://example.org/research/journeys" },
      value: "9×",
    },
    {
      detail: "Median wait from first request to a complete permit file, same fictional dataset.",
      id: "days",
      label: "days to assemble one permit file today",
      source: { name: "Example permit-office survey", url: "https://example.org/research/permits" },
      value: "12 days",
    },
  ],
  branding: {
    aboutHref: "/",
    convener: "Meridian Trails Collective",
    description: "show how a multi-party expedition journey could run on personal data stores",
    domainNegations: ["Nothing here is an offer of guided travel or insurance."],
  },
  chapters: [
    {
      anchor:
        "Ridgeway public rulebook §4.2 (fictional): one day permit per traveller per range day",
      lead: "Rowan gathers the records the journey needs — once — into a vault only Rowan controls.",
      scene: 1,
      slug: "pack-the-vault",
      steps: [
        {
          body: "Open the vault and see the traveller records already in place: club membership, route history, and the fictional persona's contact card.",
          title: "Open the vault",
          tryLive: { app: "vault", label: "Open the Traveller Vault" },
        },
        {
          body: "Grant the permit desk scoped, revocable access to exactly the two records it needs. The grant is receipted in the vault.",
          title: "Grant the permit desk access",
          tryLive: { app: "permits", label: "Visit the Permit Desk" },
        },
      ],
      title: "Pack the vault",
      underneath: [
        "The vault wrote an access grant to the traveller's own data store, scoped to two resources.",
        "A signed receipt of the grant landed beside the records it covers, so revocation has an audit trail.",
      ],
      underneathRequired: true,
    },
    {
      anchor: "Ridgeway public rulebook §5.1 (fictional): gear lists are advisory, never retained",
      lead: "The permit desk reads what it was granted, issues the day permit, and the outfitter works from the same single source.",
      scene: 2,
      slug: "prove-the-permit",
      steps: [
        {
          body: "The permit desk reads the granted records straight from the vault — no copies — and issues a day permit back into it.",
          title: "Issue the day permit",
          tryLive: { app: "permits", label: "Watch the permit issue" },
        },
        {
          body: "The outfitter checks the same permit record from the vault to size the gear list. Nothing is retained after the visit.",
          title: "Fit the gear list",
          tryLive: { app: "outfitter", label: "Open the Gear Locker" },
        },
      ],
      title: "Prove the permit",
    },
    {
      anchor:
        "Meridian route-notice convention (fictional): shared routes carry a public advisory link",
      lead: "Rowan shares the final route once, and every party sees the same advisory-linked copy.",
      scene: 3,
      slug: "share-the-route",
      steps: [
        {
          body: "The route advisory reads the shared route and attaches the public conditions notice for the range day.",
          title: "Attach the advisory",
          tryLive: { app: "advisory", label: "Open the Route Advisory" },
        },
        {
          body: "Back in the vault, Rowan reviews who saw what, then revokes the permit desk's grant now that the journey is booked.",
          title: "Review and revoke",
          tryLive: { app: "vault", label: "Review access in the vault" },
        },
      ],
      title: "Share the route",
    },
  ],
  compliance: {
    checks: [
      {
        chapterSlug: "pack-the-vault",
        citation: "Ridgeway public rulebook §4.2 (fictional)",
        citationUrl: "https://example.org/rules/day-permits",
        id: "day-permit",
        observe:
          "The permit grant and its receipt sit in the traveller's vault before the range day starts.",
        rule: "A day permit must be issued before the range day starts",
        scene: 1,
      },
      {
        chapterSlug: "share-the-route",
        citation: "Meridian route-notice convention §2 (fictional)",
        citationUrl: "https://example.org/rules/route-notices",
        id: "route-notice",
        observe:
          "The shared route record carries the advisory link, and the vault's access log shows exactly who read it.",
        rule: "A shared route must carry the public conditions notice",
        scene: 3,
      },
    ],
    nonAffiliation:
      "An illustrative checklist over public trail rules; not affiliated with or endorsed by any park or range authority.",
    title: "Steward Review",
  },
  deploy: {
    envPrefix: "TRAILS",
    slug: "trails",
  },
  editorial: {},
  persona: {
    descriptor: "Fictional persona — every value is simulated.",
    fields: [
      { label: "Name", value: "Rowan Vale" },
      {
        label: "Club membership id",
        note: "Issued by the fictional collective",
        value: "MTC-2481",
      },
      { copyable: false, label: "Emergency contact", value: "Sana Vale (fictional)" },
    ],
    footnote: "Values are pinned to the walkthrough's scripted checks.",
    name: "Rowan Vale",
  },
  registry: {
    apps: {
      advisory: {
        appName: "Route Advisory",
        healthPath: "/api/health",
        modelledOn: "Unbranded — no authority affiliation",
        path: "/advisory",
        slug: "advisory",
      },
      atlas: {
        appName: "Trail Atlas",
        healthPath: "/api/health",
        modelledOn: "Meridian Trails Collective",
        path: "/",
        slug: "atlas",
        theme: {
          accent: "oklch(0.72 0.12 95)",
          hue: 150,
          primary: "oklch(0.42 0.09 150)",
          role: "walkthrough shell",
        },
      },
      outfitter: {
        appName: "Gear Locker",
        healthPath: "/outfitter/api/health",
        modelledOn: "Bluffside Outfitters",
        path: "/outfitter",
        slug: "outfitter",
        theme: {
          accent: "oklch(0.7 0.11 60)",
          hue: 30,
          primary: "oklch(0.45 0.1 30)",
          role: "gear outfitting",
        },
        zoneEnv: "TRAILS_OUTFITTER_ZONE_URL",
      },
      permits: {
        appName: "Permit Desk",
        healthPath: "/permits/api/health",
        honesty: {
          real: ["Reads granted records from a real personal data store"],
          simulated: ["Permit decisions are scripted for the demo"],
        },
        modelledOn: "Ridgeway Range Authority",
        path: "/permits",
        podRoutes: ["/api/pod/permits"],
        slug: "permits",
        zoneEnv: "TRAILS_PERMITS_ZONE_URL",
      },
      vault: {
        appName: "Traveller Vault",
        healthPath: "/vault/api/health",
        honesty: {
          real: ["Reads and writes against a real personal data store"],
          simulated: ["Sign-in is simulated in visitor mode"],
        },
        modelledOn: "Cairn Cooperative",
        path: "/vault",
        podRoutes: ["/api/pod/grants", "/api/pod/receipts"],
        slug: "vault",
        theme: {
          accent: "oklch(0.72 0.1 200)",
          hue: 230,
          primary: "oklch(0.42 0.08 230)",
          role: "personal data custodian",
        },
        zoneEnv: "TRAILS_VAULT_ZONE_URL",
      },
    },
    center: "traveller",
    launcherOrder: ["atlas", "vault", "permits", "outfitter", "advisory"],
    roles: [
      {
        apps: ["vault"],
        center: true,
        membership: "The data subject — the centre of the ecosystem",
        modelledOn: "Cairn Cooperative",
        role: "Traveller",
        slug: "traveller",
        summary:
          "Holds every record of the journey in a vault only the traveller controls, and grants each party scoped, revocable, receipted access.",
      },
      {
        apps: ["permits"],
        membership: "Fictional collective member",
        modelledOn: "Ridgeway Range Authority",
        role: "Permit authority",
        roleNumber: 1,
        scene: 1,
        slug: "permit-authority",
        summary:
          "Issues day permits against records it reads — never copies — from the traveller's vault.",
      },
      {
        apps: ["outfitter"],
        membership: "Fictional collective member",
        modelledOn: "Bluffside Outfitters",
        role: "Gear outfitting",
        roleNumber: 2,
        scene: 2,
        slug: "outfitting",
        summary:
          "Sizes the gear list from the same permit record every other party sees, retaining nothing.",
      },
      {
        apps: ["advisory"],
        membership: "External approach",
        modelledOn: "Unbranded — no authority affiliation",
        role: "Route advisories",
        roleNumber: 3,
        scene: 3,
        slug: "advisories",
        summary: "Attaches the public conditions notice to any route shared for a range day.",
      },
      {
        apps: [],
        membership: "Mapped for a later phase",
        modelledOn: "Larkfell Stewards",
        role: "Trail stewards",
        roleNumber: 4,
        slug: "stewards",
        summary:
          "Maintains the ranges the journey crosses; mapped on the ecosystem so the seat is honest, with no app in this demo.",
      },
    ],
  },
  site: {
    appName: "Open Trails Walkthrough",
    exploreCtaLabel: "Explore the ecosystem",
    heroLead: "Travellers hold their own records. Every party gets scoped, revocable access.",
    heroParagraph:
      "A multi-party expedition today means the same facts about the traveller collected, checked, copied, and re-checked by every desk on the route. This walkthrough rebuilds that journey on personal data stores: records live in a vault the traveller controls, checks arrive once as reusable records, and each application is modelled on a fictional organisation's seat in the journey.",
    heroTitle: "One journey, many parties, one vault",
    organization: "Meridian Trails Collective",
    startCtaLabel: "Start the walkthrough",
  },
  version: 1,
};

/** A structured clone for mutation-based malformed-document tests. */
export function cloneExample(): WalkthroughDocument {
  return structuredClone(exampleWalkthrough);
}
