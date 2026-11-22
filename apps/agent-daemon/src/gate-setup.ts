// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol
import {
  CONFIG_ED25519,
  type IntroductionCard,
  introduce,
  type OwnerMandate,
  provisionAgent,
  saveAgent,
  scopedUrn,
  TrustStore,
  type TrustStoreData,
  writeTrustFile,
} from "@jeswr/agent-reference";
import { lstat, mkdir, realpath } from "fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { readGate } from "./gate.js";
import { acquireLocalLease } from "./local.js";

type Confirm = (prompt: string) => Promise<boolean>;

export function denyAllMandate({
  owner,
  actor,
  validFrom,
  validUntil,
}: Pick<OwnerMandate, "validFrom" | "validUntil"> & {
  owner: string;
  actor: string;
}): OwnerMandate {
  const policy = (name: string) => ({
    id: scopedUrn("policy", actor, name),
    type: "Set" as const,
    assigner: owner,
    assignee: actor,
    conflict: "prohibit" as const,
    permissions: [],
    prohibitions: [],
  });
  return {
    type: "OwnerMandate",
    id: scopedUrn("mandate", actor, "deny-all"),
    version: 1,
    issuer: owner,
    subject: actor,
    validFrom,
    validUntil,
    autonomous: policy("autonomous"),
    withApproval: policy("with-approval"),
  };
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Resolve symlink aliases in the existing prefix of a path which may not yet exist. */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    // A dangling symlink is an existing unsafe path, not a missing container.
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error("Unsafe gate custody path");
    } catch (statError) {
      if (!missing(statError)) throw statError;
    }
    return join(await canonical(parent), basename(path));
  }
}

function inside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

export async function initGate(o: {
  directory: string;
  ownerDir: string;
  agentWebId: string;
  ownerWebId: string;
  now?: () => Date;
  confirm: Confirm;
}): Promise<boolean> {
  async function paths() {
    const directory = await canonical(resolve(o.directory));
    const ownerDir = await canonical(resolve(o.ownerDir));
    const ownerKeyDirectory = await canonical(join(ownerDir, basename(directory)));
    if (
      inside(ownerDir, directory) ||
      inside(directory, ownerDir) ||
      inside(ownerKeyDirectory, directory) ||
      inside(directory, ownerKeyDirectory)
    )
      throw new Error("Owner custody must be outside the gate directory");
    try {
      await lstat(o.directory);
      throw new Error("Gate directory already exists");
    } catch (error) {
      if (!missing(error)) throw error;
    }
    return { directory, ownerDir };
  }
  await paths();
  for (const value of [o.agentWebId, o.ownerWebId]) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid gate WebID");
  }
  if (!(await o.confirm("Create the inbound gate and its separately held owner key?")))
    return false;
  const { directory, ownerDir } = await paths();
  const name = basename(directory);
  const agent = await provisionAgent({
    identity: { name, actor: o.agentWebId, party: o.ownerWebId },
    now: o.now?.() ?? new Date(),
    mandate: denyAllMandate,
    representationOperations: [],
  });
  await mkdir(directory, { mode: 0o700 });
  await saveAgent(dirname(directory), agent, [CONFIG_ED25519], { ownerDir });
  return true;
}

async function addPin(data: TrustStoreData, card: IntroductionCard) {
  const prior = await TrustStore.load(data);
  if (
    prior.data.keys.some(
      (key) =>
        ((key.kid === card.partyKey.kid || key.kid === card.actorKey.kid) &&
          !(key.role === "party" && key.subject === card.party && key.kid === card.partyKey.kid) &&
          !(key.role === "actor" && key.subject === card.actor && key.kid === card.actorKey.kid)) ||
        (key.role === "party" && key.subject === card.party && key.kid !== card.partyKey.kid),
    )
  )
    throw new Error("Introduction conflicts with an existing key");
  const trust = introduce(prior.data, card);
  await TrustStore.load(trust);
  return trust;
}

export async function pinPeer(o: {
  directory: string;
  card: IntroductionCard;
  confirm: Confirm;
  print?: (line: string) => void;
}): Promise<boolean> {
  const current = await readGate(o.directory);
  const card = structuredClone(o.card);
  if (
    typeof card.notice !== "string" ||
    card.notice.length > 1024 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(card.notice)
  )
    throw new Error("Invalid introduction notice");
  if (card.actor === current.identity.actor || card.party === current.identity.party)
    throw new Error("An introduction cannot replace the gate identity");
  for (const [subject, key] of [
    [card.actor, card.actorKey],
    [card.party, card.partyKey],
  ] as const) {
    if ("subject" in key && key.subject !== subject)
      throw new Error("Introduction key subject does not match its identity");
  }
  // Validate both keys, including a party key which introduce() might already know.
  await TrustStore.load(introduce({ ...current.trust, keys: [] }, card));
  await addPin(current.trust, card);
  const review = [
    `Party thumbprint: ${card.partyKey.kid}`,
    `Actor thumbprint: ${card.actorKey.kid}`,
    card.notice,
  ].join("\n");
  o.print?.(review);
  const prompt = "Confirm both thumbprints with the peer out of band before pinning.";
  if (!(await o.confirm(o.print ? prompt : `${review}\n${prompt}`))) return false;
  const release = await acquireLocalLease(current.dir, "pin.lock", 100);
  try {
    const latest = await readGate(current.dir);
    if (
      latest.identity.actor !== current.identity.actor ||
      latest.identity.party !== current.identity.party ||
      latest.actorKey.kid !== current.actorKey.kid
    )
      throw new Error("Gate identity changed during confirmation");
    const trust = await addPin(latest.trust, card);
    await writeTrustFile(current.dir, trust);
  } finally {
    await release();
  }
  return true;
}
