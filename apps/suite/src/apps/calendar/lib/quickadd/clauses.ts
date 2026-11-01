// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { normalise, reject } from "./types";

export interface Token {
  text: string;
  start: number;
  end: number;
}

export interface Clauses {
  title: string;
  date?: string;
  time?: string;
  endTime?: string;
  duration?: { minutes: number; days: boolean };
  allDay?: boolean;
  location?: string;
  rrule?: string;
  weekdays?: number[];
}

// Include unsupported scheduling cues so their recognised subparts cannot leak
// through as a successful schedule (e.g. "next Friday tomorrow" or "not today").
const cue =
  /^(?:today|tomorrow|yesterday|tonight|morning|afternoon|evening|about|around|roughly|approximately|on|at|from|to|until|for|all-day|all|every|daily|weekly|monthly|yearly|next|this|in|after|before|except|not|maybe|or|and|through|during|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|[+-]?\d.*|noon|midnight)$/i;
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const recurrenceModifier =
  /^(?:other|(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|(?:thir|four|fif|six|seven|eigh|nine)teenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth|thousandth)$/i;
const recurrenceNumberWord =
  /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|hundred|thousand|million|billion|trillion)$/i;

function startsScheduling(tokens: Token[], index: number): boolean {
  const token = tokens[index] as Token;
  // Email local parts can resemble dates or clocks; keep the whole token literal.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token.text)) return false;
  if (!cue.test(token.text)) return false;
  // These words also occur in ordinary titles. Only treat them as scheduling
  // prefixes when followed by a temporal construct (including unsupported ones).
  if (
    /^(?:about|around|roughly|approximately|on|from|to|until|for|all|every|next|this|in|after|before|except|not|maybe|or|and|through|during)$/i.test(
      token.text,
    )
  ) {
    let nextIndex = index + 1;
    // Look through interval modifiers only when they lead to a temporal
    // construct; ordinary titles such as "Read every two chapters" stay literal.
    if (token.text.toLowerCase() === "every") {
      if (recurrenceModifier.test(tokens[nextIndex]?.text ?? "")) nextIndex++;
      while (recurrenceNumberWord.test(tokens[nextIndex]?.text ?? "")) {
        nextIndex++;
        if (
          /^and$/i.test(tokens[nextIndex]?.text ?? "") &&
          recurrenceNumberWord.test(tokens[nextIndex + 1]?.text ?? "")
        ) {
          nextIndex++;
        }
      }
    }
    const next = tokens[nextIndex];
    return (
      next !== undefined &&
      (/^(?:days?|weeks?|weekdays?|months?|years?)$/i.test(next.text) ||
        startsScheduling(tokens, nextIndex))
    );
  }
  return true;
}

function clock(token: Token, input: string): string {
  const text = token.text.toLowerCase();
  if (text === "noon") return "12:00:00";
  if (text === "midnight") return "00:00:00";
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(text);
  if (!match) reject("invalid-time", input, token.start, token.end);
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3]) {
    if (hour < 1 || hour > 12) reject("invalid-time", input, token.start, token.end);
    hour = (hour % 12) + (match[3] === "pm" ? 12 : 0);
  } else if (!match[2] || hour > 23) {
    reject("invalid-time", input, token.start, token.end);
  }
  if (minute > 59) reject("invalid-time", input, token.start, token.end);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export function readClauses(input: string): Clauses {
  const tokens: Token[] = Array.from(input.matchAll(/"[^"]*"|\S+/g), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const first = tokens.findIndex((_, index) => startsScheduling(tokens, index));
  if (first < 0) reject("missing-date", input);
  const result: Clauses = { title: normalise(input.slice(0, (tokens[first] as Token).start)) };
  if (!result.title) reject("missing-title", input);

  function set<K extends keyof Clauses>(key: K, value: Clauses[K], token: Token): void {
    if (result[key] !== undefined) reject("conflicting-fields", input, token.start, token.end);
    result[key] = value;
  }

  for (let i = first; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    const word = token.text.toLowerCase();
    const next = tokens[i + 1];
    const needNext = (): Token => {
      if (!next) reject("unsupported-phrase", input, token.start, token.end);
      return next;
    };
    if (word === "today" || word === "tomorrow" || /^\d{4}-\d{2}-\d{2}$/.test(word)) {
      set("date", word, token);
    } else if (word === "on") {
      const date = needNext();
      if (!/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/i.test(date.text)) {
        reject("unsupported-phrase", input, token.start, date.end);
      }
      set("date", date.text.toLowerCase(), token);
      i++;
    } else if (word === "every" || word === "daily" || word === "weekly") {
      let rule: string;
      if (word === "daily") rule = "FREQ=DAILY";
      else if (word === "weekly") rule = "FREQ=WEEKLY";
      else {
        const frequency = needNext().text.toLowerCase();
        i++;
        const day = weekdays.indexOf(frequency);
        if (frequency === "day") rule = "FREQ=DAILY";
        else if (frequency === "week") rule = "FREQ=WEEKLY";
        else if (frequency === "weekday") {
          rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
          result.weekdays = [1, 2, 3, 4, 5];
        } else if (day >= 0) {
          rule = `FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][day]}`;
          result.weekdays = [day];
        } else reject("unsupported-phrase", input, token.start, (next as Token).end);
      }
      set("rrule", rule, token);
    } else if (word === "all-day" || (word === "all" && next?.text.toLowerCase() === "day")) {
      set("allDay", true, token);
      if (word === "all") i++;
    } else if (word === "for") {
      const amount = needNext();
      const unit = tokens[i + 2];
      if (!unit || !/^\d+(?:\.\d+)?$/.test(amount.text)) {
        reject("invalid-duration", input, token.start, amount.end);
      }
      const unitText = unit.text.toLowerCase();
      const multiplier = /^(?:minute|minutes)$/.test(unitText)
        ? 1
        : /^(?:hour|hours)$/.test(unitText)
          ? 60
          : /^(?:day|days)$/.test(unitText)
            ? 1440
            : 0;
      const scale = BigInt(10) ** BigInt(amount.text.split(".")[1]?.length ?? 0);
      const scaledMinutes = BigInt(amount.text.replace(".", "")) * BigInt(multiplier);
      if (scaledMinutes % scale !== BigInt(0)) {
        reject("invalid-duration", input, token.start, unit.end);
      }
      const minutes = Number(scaledMinutes / scale);
      const days = multiplier === 1440;
      if (!Number.isSafeInteger(minutes) || minutes <= 0 || (days && minutes % 1440 !== 0)) {
        reject("invalid-duration", input, token.start, unit.end);
      }
      set("duration", { minutes, days }, token);
      i += 2;
    } else if (word === "to" || word === "until") {
      set("endTime", clock(needNext(), input), token);
      i++;
    } else if (word === "at" && !/^(?:\d|noon$|midnight$)/i.test(needNext().text)) {
      const location: string[] = [];
      while (i + 1 < tokens.length && !cue.test((tokens[i + 1] as Token).text)) {
        location.push((tokens[++i] as Token).text);
      }
      const text = location.join(" ");
      // Quoting protects locations containing scheduling words. Mixed or unclosed
      // quotes are unsupported rather than silently losing literal text.
      if (!text || (text.includes('"') && !/^"[^"]+"$/.test(text))) {
        reject("unsupported-phrase", input, token.start, (next as Token).end);
      }
      set("location", text.replace(/^"|"$/g, ""), token);
    } else if (word === "at" || word === "from") {
      set("time", clock(needNext(), input), token);
      i++;
    } else if (/^(?:\d{1,2}(?::\d{2})?(?:am|pm)?|noon|midnight)$/i.test(word)) {
      set("time", clock(token, input), token);
    } else reject("unsupported-phrase", input, token.start, input.length);
  }
  return result;
}
