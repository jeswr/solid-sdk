// AUTHORED-BY Codex GPT-6.1-Sol
import { compareUniqueId, nonblank, TimelineError } from "./validation";

/** An active reaction on ONE message, not an add/remove event log. */
export interface Reaction {
  readonly emoji: string;
  readonly actorId: string;
}

export interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly reactedByMe: boolean;
}

/** Distinct actors per exact token; preserves emoji variants, ZWJ sequences and skin tones. */
export function aggregateReactions(reactions: readonly Reaction[], me: string): ReactionSummary[] {
  nonblank(me, "invalid-identity");
  if (!Array.isArray(reactions)) throw new TimelineError("invalid-reaction");
  const actorsByEmoji = new Map<string, Set<string>>();
  for (const reaction of reactions) {
    if (!reaction || typeof reaction !== "object") throw new TimelineError("invalid-reaction");
    nonblank(reaction.emoji, "invalid-reaction");
    nonblank(reaction.actorId, "invalid-reaction");
    let actors = actorsByEmoji.get(reaction.emoji);
    if (!actors) {
      actors = new Set<string>();
      actorsByEmoji.set(reaction.emoji, actors);
    }
    actors.add(reaction.actorId);
  }
  return [...actorsByEmoji]
    .sort(([a], [b]) => compareUniqueId(a, b))
    .map(([emoji, actors]) => ({ emoji, count: actors.size, reactedByMe: actors.has(me) }));
}

/** Chips shown per message; the rest collapse into a count so hostile data cannot flood a row. */
export const MAX_REACTION_CHIPS = 20;
/** The caller's own reactions first (so they can always be removed), then the most used. */
export function visibleReactions(
  summaries: readonly ReactionSummary[],
  limit = MAX_REACTION_CHIPS,
): { shown: ReactionSummary[]; hidden: number } {
  const ranked = [...summaries].sort(
    (a, b) => Number(b.reactedByMe) - Number(a.reactedByMe) || b.count - a.count,
  );
  const shown = ranked.slice(0, limit);
  const kept = new Set(shown);
  return {
    shown: summaries.filter((summary) => kept.has(summary)),
    hidden: ranked.length - shown.length,
  };
}
