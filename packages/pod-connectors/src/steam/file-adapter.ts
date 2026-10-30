// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Steam → Media + Social (Tier-C file import).
 *
 * Steam's account-data download is a set of files; the high-value, structured
 * one for a personal data manager is the **owned-games list**. We accept a JSON
 * file in the shape Steam (and its Web API `GetOwnedGames`) uses:
 *
 *   { "response"?: { "games": [...] } } | { "games": [...] } | [ ...games ]
 *   game = { appid, name, playtime_forever (minutes), img_icon_url? }
 *
 * Optionally an account object `{ steamid, personaname }` at the top level.
 *
 * Each game becomes a `schema:VideoGame` (Media) with total playtime as an
 * ISO-8601 duration; the account, when present, becomes a `foaf:OnlineAccount`
 * (Social). Parsed with `JSON.parse` (no dependency); fully untrusted input,
 * coerced to inert RDF literals.
 */
import { DataFactory, Store } from "n3";
import { isoDurationFromMinutes } from "../core/duration.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { jsonEntries } from "../core/file-json.js";
import { recordFragment, sourceItemUrl } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES, OnlineAccount, VideoGame } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "steam";

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Steam",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["media", "social"],
  whatYouGet: "Your games and playtime into Media, and your account into Social.",
  requirements: [],
};

export interface SteamGame {
  readonly appid?: number | string;
  readonly name: string;
  readonly minutes?: number;
}

export const steamFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".json,application/json",
  fileHint:
    "Steam → Account details → Download a copy of my data. From the export, select your owned-games JSON (games + playtime).",
  exportUrl: "https://help.steampowered.com/en/accountdata",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your games…", done: 0, total: 1 });
    const account: { steamid?: string; personaname?: string } = {};

    const gamesDoc = ctx.resolve("media/steam-games.ttl");
    const games = new Store();
    let count = 0;
    for await (const entry of jsonEntries(
      file,
      ["", "games", "response.games"],
      ["steamid", "personaname"],
      ctx.skip,
    )) {
      if (entry.path === "steamid" || entry.path === "personaname") {
        if (typeof entry.value === "string") account[entry.path] = entry.value;
        continue;
      }
      if (count >= ctx.maxRows) continue;
      const g = parseSteamExport(JSON.stringify([entry.value]), 1).games[0];
      if (!g) continue;
      count++;
      const key = `${g.appid ?? ""}|${g.name}`;
      const frag = recordFragment(g.name, key);
      const game = new VideoGame(`${gamesDoc}#game-${frag}`, games, DataFactory).mark();
      game.name = g.name;
      if (g.appid != null) {
        game.identifier = String(g.appid);
        game.sourceUrl = sourceItemUrl("https://store.steampowered.com/app/", String(g.appid));
      }
      if (g.minutes != null && g.minutes > 0) {
        game.timeRequired = isoDurationFromMinutes(g.minutes);
      }
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    if (games.size > 0) {
      await ctx.write({
        slug: "media/steam-games.ttl",
        category: "media",
        forClass: CLASSES.VideoGame,
        dataset: games,
      });
    }

    if (account.steamid || account.personaname) {
      const acctDoc = ctx.resolve("social/steam-account.ttl");
      const accounts = new Store();
      const acct = new OnlineAccount(`${acctDoc}#account`, accounts, DataFactory).mark();
      acct.name = account.personaname ?? "Steam account";
      acct.accountName = account.personaname ?? account.steamid;
      acct.accountServiceHomepage = "https://store.steampowered.com/";
      if (account.steamid) {
        acct.identifier = account.steamid;
        acct.sourceUrl = sourceItemUrl("https://steamcommunity.com/profiles/", account.steamid);
      }
      await ctx.write({
        slug: "social/steam-account.ttl",
        category: "social",
        forClass: CLASSES.OnlineAccount,
        dataset: accounts,
      });
    }
  },
};

interface SteamParsed {
  readonly games: SteamGame[];
  readonly account?: { steamid?: string; personaname?: string };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Parse a Steam owned-games JSON in any of the common nestings. */
export function parseSteamExport(text: string, limit = Number.POSITIVE_INFINITY): SteamParsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { games: [] };
  }
  const rawGames = locateGames(data);
  const games: SteamGame[] = [];
  for (const raw of rawGames) {
    if (games.length >= limit) break;
    if (!isObject(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : undefined;
    if (!name) continue;
    const appid =
      typeof raw.appid === "number" || typeof raw.appid === "string" ? raw.appid : undefined;
    const minutes = typeof raw.playtime_forever === "number" ? raw.playtime_forever : undefined;
    games.push({ appid, name, minutes });
  }

  let account: SteamParsed["account"];
  if (isObject(data)) {
    const steamid = typeof data.steamid === "string" ? data.steamid : undefined;
    const personaname = typeof data.personaname === "string" ? data.personaname : undefined;
    if (steamid || personaname) account = { steamid, personaname };
  }
  return { games, account };
}

function locateGames(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isObject(data)) {
    if (Array.isArray(data.games)) return data.games;
    if (isObject(data.response) && Array.isArray(data.response.games)) return data.response.games;
  }
  return [];
}
