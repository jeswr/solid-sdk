// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { type Account, foldBindingControls } from "@jeswr/agent-model";
import { type AgentClient, createAgentClient, isLoaded, type Row, type Unreadable } from "./client";
import type { ProfileSession } from "./profile";
import { type DisplayControl, loadedRecords, readAccounts, readControl } from "./readers";
import { createAgentSigner } from "./sign";
import { createAgentVerifier } from "./verify";

/** The inventory stores provider names; descriptors and mandates use binding identifiers. */
export function accountBinding(account: Pick<Account, "channel" | "provider">): string {
  if (account.channel === "email") {
    if (["google", "google_workspace"].includes(account.provider)) return "gmail";
    if (account.provider === "microsoft") return "graph-mail";
  }
  const aliases: Record<string, string> = {
    microsoft_teams: "graph-teams",
    phone_messages: "imessage",
    matrix_bot: "matrix",
    signal: "matrix",
    whatsapp: "matrix",
    github_notifications: "github",
  };
  return Object.hasOwn(aliases, account.channel)
    ? (aliases[account.channel] as string)
    : account.provider;
}

/** Only a plain profile name is placed in a command; secret-store references never leave the model. */
export function accountLoginCommand(account: Pick<Account, "id" | "channel" | "credentialRef">) {
  const plain = account.credentialRef?.replace(/^profile:/, "");
  const slug = new URL(account.id).pathname.split("/").pop() as string;
  const profile =
    plain && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(plain)
      ? plain
      : `${account.channel.replace(/[^A-Za-z0-9_-]/g, "-")}-${slug
          .replace(/\.(?:ttl|trig)$/, "")
          .replace(/[^A-Za-z0-9._-]/g, "-")}`;
  return `awp login ${profile}`;
}

type AccountControl = DisplayControl;

function accountControls(
  account: Account,
  controls: readonly AccountControl[],
  owner: string,
  now: number,
) {
  return controls.filter(
    (control) =>
      control.verification === "verified" &&
      control.attributedTo === owner &&
      control.kind === "SetBindingState" &&
      control.target === account.id &&
      control.binding === accountBinding(account) &&
      Date.parse(control.createdAt) <= now &&
      Date.parse(control.expires) > now,
  );
}
/** A signed change remains visible while the daemon catches up with its account record. */
export function overlayAccountControls(
  account: Account,
  controls: readonly AccountControl[],
  owner: string,
  now: number,
): Account {
  return foldBindingControls(
    account,
    accountControls(account, controls, owner, now).map((control) => ({
      ...control,
      type: "control-statement" as const,
    })),
  );
}

export async function readAccountSettings(
  client: AgentClient,
  session: ProfileSession,
  now = Date.now(),
): Promise<Row<Account>[]> {
  const [accounts, controls] = await Promise.all([
    readAccounts(client),
    readControl(
      client,
      createAgentVerifier(session, () => new Date(now)),
    ),
  ]);
  return [
    ...accounts.map((row) =>
      isLoaded(row)
        ? {
            ...row,
            record: overlayAccountControls(row.record, loadedRecords(controls), session.webId, now),
          }
        : row,
    ),
    ...controls.filter((row): row is Unreadable => !isLoaded(row)),
  ];
}

export type AccountSettings = Pick<Account, "restrictions" | "bindingState">;
export interface AccountPatch {
  restrictions?: Partial<Account["restrictions"]>;
  bindingState?: Account["bindingState"];
}
/** Read through HTTP caches, including the listing and the owner's verification keys. */
export async function persistAccountPatch(
  client: AgentClient,
  session: ProfileSession,
  id: string,
  patch: AccountPatch,
  now = () => new Date(),
): Promise<AccountSettings> {
  const freshIo: ProfileSession["fetch"] = (input, init) =>
    session.fetch(input, { ...init, cache: "no-store" });
  const fresh = createAgentClient({
    fetch: freshIo,
    storage: client.workspace,
    workspace: client.workspace,
  });
  const verifiedSession = { ...session, fetch: freshIo };
  const read = async () => {
    const [row, controls] = await Promise.all([
      fresh.read(id, "account"),
      readControl(fresh, createAgentVerifier(verifiedSession, now)),
    ]);
    if (controls.some((c) => !isLoaded(c))) throw new Error("Couldn't check the latest settings.");
    const relevant = accountControls(
      row.record,
      loadedRecords(controls),
      session.webId,
      now().getTime(),
    );
    return {
      settings: overlayAccountControls(row.record, relevant, session.webId, now().getTime()),
      controls: relevant,
    };
  };
  const before = await read();
  await createAgentSigner(verifiedSession, fresh, now).signControl("SetBindingState", {
    target: id,
    binding: accountBinding(before.settings),
    // A restriction toggle cannot reconnect an account, even if a disconnect races the signature.
    ...(patch.bindingState ? { bindingState: patch.bindingState } : {}),
    ...(patch.restrictions ? { restrictions: patch.restrictions } : {}),
  });
  const after = await read();
  return applyPatch(after.settings, {});
}

function applyPatch(value: AccountSettings, patch: AccountPatch): AccountSettings {
  return {
    bindingState: patch.bindingState ?? value.bindingState,
    restrictions: { ...value.restrictions, ...patch.restrictions },
  };
}

/** Serial writes and field-scoped patches prevent a failed toggle resurrecting another failed edit. */
export class AccountSettingsQueue {
  private pending: AccountPatch[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private baseline: AccountSettings;
  constructor(
    baseline: AccountSettings,
    private readonly persist: (patch: AccountPatch) => Promise<AccountSettings> | Promise<void>,
    private readonly changed: () => void,
  ) {
    this.baseline = {
      bindingState: baseline.bindingState,
      restrictions: { ...baseline.restrictions },
    };
  }
  get value(): AccountSettings {
    return this.pending.reduce(applyPatch, this.baseline);
  }
  get busy(): boolean {
    return this.pending.length > 0;
  }
  reconcile(settings: AccountSettings): void {
    if (!this.busy)
      this.baseline = {
        bindingState: settings.bindingState,
        restrictions: { ...settings.restrictions },
      };
  }
  async change(patch: AccountPatch): Promise<void> {
    const value = this.value;
    const next = applyPatch(value, patch);
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    this.pending.push(patch);
    this.changed();
    const job = this.tail.then(async () => {
      try {
        const confirmed = applyPatch(this.baseline, patch);
        this.baseline = (await this.persist(patch)) ?? confirmed;
      } finally {
        this.pending = this.pending.filter((item) => item !== patch);
        this.changed();
      }
    });
    this.tail = job.catch(() => undefined);
    await job;
  }
}
