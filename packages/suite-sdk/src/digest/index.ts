// AUTHORED-BY Codex GPT-6.1-Sol
export {
  type DigestSchedule,
  inQuietHours,
  isDue,
  nextDigestTime,
  type QuietHours,
} from "./schedule.js";

/** Transport-independent input. Times are epoch milliseconds; ids are stable across sources. */
export interface DigestNotification {
  id: string;
  kind: string;
  category?: string;
  app: string;
  actor?: { id?: string; name: string };
  target?: { id: string; title: string };
  title: string;
  time: number;
  read: boolean;
  urgent?: boolean;
  blocking?: boolean;
}
export function classifyUrgency(n: DigestNotification): boolean {
  const categories = [n.kind, n.category];
  return (
    n.urgent === true ||
    ["access-request", "security", "sign-in", "direct-mention", "mention"].some((category) =>
      categories.includes(category),
    ) ||
    (categories.includes("agent-approval") && n.blocking === true)
  );
}
export interface DigestItem {
  id: string;
  notificationIds: string[];
  text: string;
  count: number;
  unread: number;
  urgent: boolean;
  newest: number;
}
export interface DigestSection {
  app: string;
  count: number;
  items: DigestItem[];
}
export interface Digest {
  since: number;
  now: number;
  /** Bounded receipt history, including prior deliveries. */
  digestedIds: string[];
  count: number;
  unread: number;
  omitted: number;
  headline: string;
  sections: DigestSection[];
  agent: { actionsTaken: number; approvalsWaiting: number };
}
export interface DigestOptions {
  since: number;
  now: number;
  /** When supplied, receipts replace the lower timestamp boundary, admitting late arrivals. */
  digestedIds?: readonly string[];
}
const compare = (a: DigestNotification, b: DigestNotification) =>
  Number(classifyUrgency(b)) - Number(classifyUrgency(a)) ||
  Number(a.read) - Number(b.read) ||
  b.time - a.time ||
  lexical(a.id, b.id);
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function groupText(items: DigestNotification[]): string {
  const first = items[0] as DigestNotification;
  const category = first.category ?? first.kind;
  const actors = [
    ...new Map(
      items.filter((n) => n.actor).map((n) => [n.actor?.id ?? n.actor?.name, n.actor?.name]),
    ).values(),
  ];
  const who = actors.length
    ? `${actors[0]}${actors.length > 1 ? ` and ${plural(actors.length - 1, "other")}` : ""}`
    : "";
  const target = first.target?.title;
  if (category === "comment" && target)
    return who
      ? `${who} commented on ${target}${items.length > 1 ? ` (${plural(items.length, "comment")})` : ""}`
      : `${plural(items.length, "comment")} on ${target}`;
  if (category === "shared" && target)
    return `${who || "Someone"} shared ${target}${items.length > 1 ? ` (${plural(items.length, "update")})` : ""}`;
  if (category === "agent-action") return `Your agent did ${plural(items.length, "thing")}`;
  if (category === "agent-approval") return `${plural(items.length, "approval")} waiting`;
  return `${first.title}${items.length > 1 ? ` (${plural(items.length, "update")})` : ""}`;
}

export function buildDigest(
  notifications: readonly DigestNotification[],
  options: DigestOptions & { summarise: (digest: Digest) => Promise<string> },
): Promise<Digest>;
export function buildDigest(
  notifications: readonly DigestNotification[],
  options: DigestOptions,
): Digest;
export function buildDigest(
  notifications: readonly DigestNotification[],
  options: DigestOptions & { summarise?: (digest: Digest) => Promise<string> },
): Digest | Promise<Digest> {
  // Dedupe first, so duplicated transport copies cannot inflate counts. Newest content wins.
  const unique = new Map<string, DigestNotification>();
  const digested = options.digestedIds && new Set(options.digestedIds);
  for (const n of notifications) {
    if (
      !Number.isFinite(n.time) ||
      n.time > options.now ||
      (digested ? digested.has(n.id) : n.time <= options.since)
    )
      continue;
    const old = unique.get(n.id);
    if (!old || n.time > old.time || (n.time === old.time && compare(n, old) < 0))
      unique.set(n.id, n);
  }
  const ordered = [...unique.values()].sort(compare);
  const groups = new Map<string, DigestNotification[]>();
  const agent = { actionsTaken: 0, approvalsWaiting: 0 };
  for (const n of ordered) {
    const category = n.category ?? n.kind;
    if (category === "agent-action") agent.actionsTaken++;
    if (category === "agent-approval") agent.approvalsWaiting++;
    const app = category.startsWith("agent-") ? "agent" : n.app;
    const key = JSON.stringify([app, n.target?.id ?? n.title, category, !!n.target]);
    const group = groups.get(key);
    if (group) group.push(n);
    else groups.set(key, [n]);
  }
  const sections = new Map<string, DigestSection>();
  let shown = 0;
  let represented = 0;
  for (const items of groups.values()) {
    const first = items[0] as DigestNotification;
    const app = (first.category ?? first.kind).startsWith("agent-") ? "agent" : first.app;
    let section = sections.get(app);
    if (!section) {
      section = { app, count: 0, items: [] };
      sections.set(app, section);
    }
    section.count += items.length;
    if (shown++ >= 50) continue;
    represented += items.length;
    section.items.push({
      id: first.id,
      notificationIds: items.slice(0, 100).map((n) => n.id),
      text: groupText(items),
      count: items.length,
      unread: items.filter((n) => !n.read).length,
      urgent: items.some(classifyUrgency),
      newest: items.reduce((latest, n) => Math.max(latest, n.time), -Infinity),
    });
  }
  const visible = [...sections.values()].filter((section) => section.items.length);
  const phrases = visible
    .filter((s) => s.app !== "agent")
    .flatMap((s) => s.items.map((i) => i.text))
    .slice(0, 3);
  if (agent.actionsTaken) phrases.push(`your agent did ${plural(agent.actionsTaken, "thing")}`);
  if (agent.approvalsWaiting) phrases.push(`${plural(agent.approvalsWaiting, "approval")} waiting`);
  if (!phrases.length && visible.length)
    phrases.push(((visible[0] as DigestSection).items[0] as DigestItem).text);
  const digest: Digest = {
    since: options.since,
    now: options.now,
    digestedIds: [...new Set([...(options.digestedIds ?? []), ...ordered.map((n) => n.id)])].slice(
      -500,
    ),
    count: ordered.length,
    unread: ordered.filter((n) => !n.read).length,
    omitted: ordered.length - represented,
    sections: visible,
    agent,
    headline: ordered.length
      ? oneLine(`While you were away: ${phrases.join("; ")}`)
      : "You're all caught up",
  };
  if (options.summarise)
    return options
      .summarise(digest)
      .then((headline) => ({ ...digest, headline: oneLine(headline) || digest.headline }));
  return digest;
}
