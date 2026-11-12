// AUTHORED-BY Codex GPT-6.1-Sol
import type { MigrationPlan } from "@jeswr/pod-migrator";
export const sourceRoot = "https://storage.example/alice/";
export const targetRoot = "https://storage.example/bob/";
export const samplePlan: MigrationPlan = {
  sourceSystem: "wac",
  targetSystem: "acp",
  resources: [
    {
      sourceUrl: `${sourceRoot}notes.txt`,
      targetUrl: `${targetRoot}notes.txt`,
      kind: "resource",
      contentType: "text/plain",
      size: 80,
    },
  ],
  stats: { resources: 1, containers: 1, bytes: 80, aclDocuments: 2 },
  report: [
    {
      id: "owner",
      kind: "source-owner-kept",
      severity: "info",
      resourceUrl: sourceRoot,
      title: "Keep the source account’s access",
      explanation: "The source account can still access these files with the same WebID.",
      options: [
        {
          id: "acknowledge",
          label: "Keep this access",
          description: "Keep the original account’s permissions.",
        },
      ],
      recommended: "acknowledge",
    },
    ...["friends", "colleagues"].map((name) => ({
      id: name,
      kind: "group-unsupported" as const,
      severity: "needs-decision" as const,
      resourceUrl: `${sourceRoot}${name}/`,
      title: `Group access for ${name}`,
      explanation:
        "The destination cannot follow this group’s changing membership. Choose how to handle its access.",
      sourceRuleTurtle:
        "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#group> acl:mode acl:Read.",
      options: [
        {
          id: "skip" as const,
          label: "Leave out the group grant",
          description: "Group members will not gain access from this rule.",
        },
        {
          id: "abort" as const,
          label: "Stop the migration",
          description: "Do not write anything to the destination.",
        },
      ],
      recommended: "skip" as const,
    })),
  ],
};
