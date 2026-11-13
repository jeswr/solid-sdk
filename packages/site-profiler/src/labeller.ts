// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 6: labelling. The Labeller seam names what an endpoint does in schema.org terms and its
// effect class. The default is deterministic heuristics; an LLM labeller can implement the same
// interface later. Unknown writes default to the conservative 'irreversible-write'.

import type { EndpointCandidate, Label, Labeller } from "./types.js";
import { s, sab, singular } from "./util.js";

const SEARCH_PARAM = /^(q|query|search|keyword|keywords|term|s|text)$/i;

function pathWords(c: EndpointCandidate): string[] {
  const path = new URL(c.urlTemplate.replace(/\{[^}]*\}/g, "")).pathname;
  return path
    .split("/")
    .filter((w) => w && !/^(api|v\d+|rest|graphql|json)$/i.test(w))
    .map((w) => w.toLowerCase());
}

function noun(c: EndpointCandidate, fallback: string): string {
  const words = pathWords(c).filter((w) => !/^(search|find|query)$/.test(w));
  const template = c.urlTemplate.replace(/\{[^}]*\}/g, "");
  const query = new URL(template).searchParams;
  const dispatch = [...query].find(([k]) =>
    /^(namespace|resource|collection|dataset)$/i.test(k),
  )?.[1];
  if (dispatch) return dispatch.replace(/[_-]+(?:grid|listing|list)$/, "").replace(/[_-]+/g, " ");
  const last = words[words.length - 1];
  return last ? singular(last).replace(/[-_]+/g, " ") : fallback;
}

/** True for a password login form or a token endpoint taking a username and password. */
export function isLoginCandidate(c: EndpointCandidate): boolean {
  if (c.method !== "POST") return false;
  if (c.form?.hasPassword) return true;
  const names = c.params.map((p) => p.name.toLowerCase());
  return (
    names.some((n) => /pass(word)?|pwd/.test(n)) && names.some((n) => /user|email|login/.test(n))
  );
}

export class HeuristicLabeller implements Labeller {
  async label(c: EndpointCandidate): Promise<Label> {
    const words = pathWords(c);
    const joined = words.join("/");
    const hasPathVar = c.params.some((p) => p.location === "path");
    if (isLoginCandidate(c)) {
      const label = c.form ? "Sign in" : "Get access token";
      return {
        actionType: sab("LoginAction"),
        label,
        effect: "reversible-write",
        confidence: c.form ? 0.9 : 0.6,
      };
    }
    if (c.method === "GET") {
      if (/(^|\/)(log-?in|sign-?in|log-?out|sign-?out|register|sign-?up)$/.test(joined)) {
        return { ...skip(), reason: "authentication page" };
      }
      const search = c.params.find((p) => p.location === "query" && SEARCH_PARAM.test(p.name));
      if (search) {
        const dispatched = /[?&](?:namespace|resource|collection|dataset)=/.test(c.urlTemplate);
        const what = dispatched
          ? `${noun(c, "items")} (JSON)`
          : c.responseKind === "json"
            ? "products (JSON)"
            : "products";
        return {
          actionType: s("SearchAction"),
          label: `Search ${what}`,
          effect: "read",
          confidence: 0.85,
        };
      }
      if (hasPathVar) {
        const thing = noun(c, "item");
        const api = c.responseKind === "json" ? " (JSON)" : "";
        return {
          actionType: s("ViewAction"),
          label: `View ${thing}${api}`,
          effect: "read",
          confidence: 0.8,
        };
      }
      if (c.responseKind === "json") {
        return {
          actionType: s("ViewAction"),
          label: `View ${noun(c, "data")} (JSON)`,
          effect: "read",
          confidence: 0.7,
        };
      }
      if (c.responseKind === "html") {
        const page = words.length ? noun(c, "page") : "home page";
        return {
          actionType: s("ViewAction"),
          label: `View ${page}`,
          effect: "read",
          confidence: 0.6,
        };
      }
      return { ...skip(), reason: "no readable response" };
    }
    if (/(^|\/)(log-?out|sign-?out)$/.test(joined)) {
      return {
        actionType: sab("LogoutAction"),
        label: "Sign out",
        effect: "reversible-write",
        confidence: 0.8,
      };
    }
    if (
      /(checkout|place-?order|purchase|payment|pay)(\/|$)/.test(joined) ||
      (/orders?$/.test(joined) && c.method === "POST")
    ) {
      return {
        actionType: s("OrderAction"),
        label: "Place order",
        effect: "payment",
        confidence: 0.8,
      };
    }
    if (/(cart|basket|bag|trolley)/.test(joined)) {
      if (c.method === "DELETE") {
        return {
          actionType: s("DeleteAction"),
          label: "Remove from basket",
          effect: "reversible-write",
          confidence: 0.8,
        };
      }
      if (c.method === "POST" || c.method === "PUT") {
        return {
          actionType: s("AddToCartAction"),
          label: "Add to basket",
          effect: "reversible-write",
          confidence: 0.85,
        };
      }
      return {
        actionType: s("UpdateAction"),
        label: "Update basket",
        effect: "reversible-write",
        confidence: 0.7,
      };
    }
    if (c.method === "DELETE") {
      return {
        actionType: s("DeleteAction"),
        label: `Delete ${noun(c, "item")}`,
        effect: "irreversible-write",
        confidence: 0.6,
      };
    }
    if (c.method === "PUT" || c.method === "PATCH") {
      return {
        actionType: s("UpdateAction"),
        label: `Update ${noun(c, "item")}`,
        effect: "irreversible-write",
        confidence: 0.5,
      };
    }
    return {
      actionType: s("CreateAction"),
      label: `Create ${noun(c, "item")}`,
      effect: "irreversible-write",
      confidence: 0.4,
    };
  }
}

function skip(): Label {
  return { actionType: s("Action"), label: "", effect: "read", confidence: 0, skip: true };
}

export const heuristicLabeller: Labeller = new HeuristicLabeller();
