// AUTHORED-BY Codex GPT-6
// Deterministic, inert screenshot engine; never included in production builds.
export function createPodHttp({ root }: { root: string }) {
  return { root };
}

export async function planMigration({ onProgress }: { onProgress?: (progress: unknown) => void }) {
  onProgress?.({ phase: "plan", done: 128, total: 128 });
  return {
    sourceSystem: "wac",
    targetSystem: "acp",
    resources: [],
    stats: { containers: 12, resources: 116, bytes: 2841024, aclDocuments: 24 },
    report: [
      {
        id: "owner",
        kind: "source-owner-kept",
        severity: "info",
        resourceUrl: "https://alice.solidcommunity.net/",
        title: "Your source account keeps its access",
        explanation:
          "Your original WebID will keep the permissions it already has, so you can continue using both accounts.",
        recommended: "acknowledge",
        options: [
          {
            id: "acknowledge",
            label: "Keep this access",
            description: "Keep the original account’s permissions.",
          },
        ],
      },
      {
        id: "friends",
        kind: "group-unsupported",
        severity: "needs-decision",
        resourceUrl: "https://alice.solidcommunity.net/shared/",
        title: "Choose what happens to your friends group",
        explanation:
          "The destination cannot follow this group’s changing membership. Leaving out this grant means the group will not receive access from this rule. It does not make anything more public.",
        sourceRuleTurtle:
          "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#friends> acl:mode acl:Read.",
        recommended: "skip",
        options: [
          {
            id: "skip",
            label: "Leave out the group grant",
            description: "Group members will not receive access from this rule.",
          },
          {
            id: "expand",
            label: "Use the current members",
            description:
              "Give access to the people in the group today. Future membership changes will not follow.",
          },
          {
            id: "abort",
            label: "Stop the migration",
            description: "Do not write anything to the destination.",
          },
        ],
      },
    ],
  };
}

export function finalizePlan(plan: unknown, resolutions: unknown) {
  return { plan, resolutions };
}

export async function executeMigration(
  _plan: unknown,
  { onProgress, signal }: { onProgress?: (progress: unknown) => void; signal?: AbortSignal },
) {
  onProgress?.({
    phase: "copy",
    done: 42,
    total: 116,
    current: "https://storage.example/pods/alice/documents/notes.ttl",
  });
  await new Promise<void>((resolve) => {
    const finish = () => {
      window.removeEventListener("finish-fixture-migration", finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    window.addEventListener("finish-fixture-migration", finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
  return {
    copied: ["https://storage.example/pods/alice/documents/notes.ttl"],
    skipped: [
      {
        url: "https://alice.solidcommunity.net/profile/card",
        reason: "Destination profile protected",
      },
    ],
    failed: [],
    aclWritten: ["https://storage.example/pods/alice/documents/notes.ttl.acr"],
    verified: !signal?.aborted,
    cancelled: signal?.aborted ?? false,
    log: [{ at: "2026-10-27T12:00:00Z", level: "info", message: "Completed screenshot fixture." }],
  };
}
