// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// autologin-fragment.ts — the EXACT, vendored copy of create-solid-app's
// `autologinFragment(webId)` builder (template/lib/solid/autologin.ts), the
// producer side of the `#autologin/<encodeURIComponent(webid)>` deep-link SSO
// (media-kraken#54). The 8 vite pod-apps + Solid Issues each ship the PARSER
// (`parseAutologinFragment`) of the same shape in their own auth seam; vendoring
// the canonical producer here keeps the two in lock-step — never hand-concatenate
// the fragment in a launch URL builder.
//
// WHY VENDORED (not imported): create-solid-app is a CLI scaffolder whose
// `template/` is not a published package export, so there is no importable
// `autologinFragment`. The builder is a single deterministic line; vendoring it
// with the unit test (autologin-fragment.test.ts) that pins the exact
// `#autologin/<encodeURIComponent(webid)>` byte-shape against the create-solid-app
// reference is the maintainable way to guarantee the producer matches every app's
// parser. If create-solid-app ever publishes the helper, switch to the import and
// drop this copy in the same change.
//
// TOKEN-SAFETY (load-bearing): the fragment carries ONLY the user's PUBLIC WebID
// (a WebID is public by definition). Per RFC 3986 §3.5 a fragment is client-side
// and is NEVER transmitted on the wire, so the WebID does not even reach the
// target server's logs. NO token / credential is ever placed here.

/** The deep-link fragment prefix: `#autologin/<encodeURIComponent(webid)>`. */
export const AUTOLOGIN_FRAGMENT_PREFIX = "#autologin/";

/**
 * Build the autologin deep-link fragment for a WebID — the inverse of the target
 * apps' `parseAutologinFragment`. Verbatim from create-solid-app
 * (template/lib/solid/autologin.ts:416): the WebID is `encodeURIComponent`-encoded
 * so a WebID containing `#` (the `#me` fragment) or other reserved characters
 * round-trips through the parser unambiguously.
 */
export function autologinFragment(webId: string): string {
  return `${AUTOLOGIN_FRAGMENT_PREFIX}${encodeURIComponent(webId)}`;
}
