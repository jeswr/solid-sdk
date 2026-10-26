# Provider configuration and token contract (calendar actions)

This is the interface between the deterministic actions (`src/actions/`) and whatever sets up
provider access (interactive sign-in, token storage, refresh). The actions never sign in, never
store tokens and never read a credential store; they ask for a short-lived access token at the
moment they call a provider, through the contract below.

## 1. What is called, with which minimum scope

| Provider | Call | Minimum scope requested | Also accepted if granted |
|---|---|---|---|
| Google Calendar | `POST https://www.googleapis.com/calendar/v3/freeBusy` (one request, ≤ 50 calendar IDs) | `https://www.googleapis.com/auth/calendar.freebusy` | `calendar.events.freebusy`, `calendar.readonly`, `calendar` |
| Microsoft Graph (work/school **and** personal accounts) | `GET https://graph.microsoft.com/v1.0/me/calendars/{id}/calendarView` (or `/me/calendar/calendarView` for `primary`), `$select=showAs,isAllDay,isCancelled,start,end,type`, `Prefer: outlook.timezone="UTC"`, paged with `@odata.nextLink` | `Calendars.ReadBasic` | `Calendars.Read`, `Calendars.ReadWrite` |

`getSchedule` is deliberately **not** used: Microsoft documents it as unsupported for delegated
personal Microsoft accounts, and it answers per mailbox rather than per selected calendar.
`calendarView` is read per owner-selected calendar ID (including secondary calendars).

No other provider call exists in this version: no mail, chat, draft, send or event write.

## 2. Operator configuration file (trusted, no secrets)

Location: chosen by the operator and passed to the server process only:
`awp-dashboard serve --provider-config /abs/path/providers.json` (or `AWP_PROVIDER_CONFIG`), and
the same flag for `awp-dashboard actions …`. It is never chosen by a browser or an action request.

```json
{
  "version": 1,
  "accounts": [
    {
      "connectionId": "email-example-gmail",
      "provider": "google",
      "credential": { "type": "helper", "command": "/abs/path/to/awp-credential-helper", "args": ["--profile", "personal"] }
    },
    {
      "connectionId": "email-example-outlook",
      "provider": "microsoft",
      "credential": { "type": "helper", "command": "/abs/path/to/awp-credential-helper", "args": ["--profile", "work"] }
    }
  ]
}
```

Rules enforced by `loadProviderConfig`:

- `connectionId` is the dashboard account record the calendars belong to.
- `command` must be an absolute path; `args` are fixed strings; no shell is used.
- The file must not be group- or world-writable.
- Any key that looks like a credential (`token`, `secret`, `password`, `refresh`, `bearer`) is
  refused: **no bearer or refresh token is ever stored in this file, in dashboard settings, in
  the API, the UI or logs.**

Which calendars to read is owner data in the dashboard settings: an *external* calendar with
`provider` (`google…` or `microsoft…`/`outlook…`), `connectionId` and `providerCalendarId`
(Google calendar ID, e.g. `primary` or `…@group.calendar.google.com`; Microsoft calendar `id`, or
`primary` for the default calendar). The owner marks it as counting for availability and allowed
to be read.

## 3. Credential helper protocol

The helper is a separate program that owns sign-in, token storage and refresh. This repository
provides one: `awp-credentials` (`src/credentials/`, set up as described in
[`PROVIDER-SETUP.md`](PROVIDER-SETUP.md)). Its `provider-config` command writes the
configuration above. Any program implementing this protocol may be used instead. For each
provider call the action runs it once:

- **stdin** (JSON): `{"provider":"google"|"microsoft","connectionId":"…","scopes":["…minimum scopes…"]}`
- **stdout** (JSON, ≤ 16 KiB): `{"access_token":"…","expires_at":"<ISO 8601>"?,"scope":"space separated granted scopes"?}`
- **exit code**: `0` token returned; `3` access revoked / consent withdrawn / no grant (the
  action reports *needs setup*); anything else: unavailable.
- stderr is discarded (never logged). Time limit: 10 s. The runner settles exactly once:
  - it kills the helper on timeout or oversize;
  - it tolerates a helper that exits before reading its request (EPIPE);
  - it reports each failure as a typed error without the helper's output.

  The token is used for that one call and not kept.
- `expires_at` must be a strict RFC 3339 date-time. A malformed value is refused, and a past
  one is treated as revoked. The token itself must be printable ASCII of 8 to 8192 characters.

If `scope` is returned and grants none of the accepted scopes above, the adapter does not call
the provider and reports *needs setup* (insufficient scope). An expired `expires_at` is refused.

Tests and the fixture demo use an injected token provider instead
(`AccessTokenProvider.getAccessToken`), which is the same interface.

## 4. What the adapters guarantee

- Fixed origins only (`www.googleapis.com`, `graph.microsoft.com`). Graph `@odata.nextLink` is
  followed only when it continues exactly the same calendarView request:
  - same origin and calendar path, and the same `startDateTime`/`endDateTime`;
  - no credentials or fragment in the link, and no link seen before;
  - at most 20 pages / 5 000 events per calendar.
- 10 s per request, 1 MiB per response body, `redirect: "error"`.
- Only busy intervals are kept: no titles, attendees, locations or bodies are requested
  (Graph `$select`) or returned.
- **Fail closed:** HTTP errors (401 revoked/expired, 403 scope/access, 404 missing calendar,
  429/5xx), per-calendar Google `errors`, a Google calendar entry without a `busy` list, a Google
  response not covering the requested window, non-RFC-3339 or impossible times, non-IANA time
  zones, DST-skipped wall-clock times, events or all-day ranges that do not move forward,
  truncated or redirected paging, or an unconfigured credential all make that source *blocked* — and any blocked source makes the whole availability answer blocked.
  Nothing is ever read as "free" because it could not be read.
- Microsoft `showAs`: only `free` is free; `busy`, `tentative`, `oof`, `workingElsewhere`,
  `unknown` or a missing value count as busy (conservative). `isCancelled` events are ignored.
  All-day events block the whole local day(s) in the owner's time zone **and** their literal
  interval. `calendarView` returns expanded occurrences of recurring series.
- Google `freeBusy` already excludes transparent and cancelled events (server side).

## 5. Fixture mode (no network)

`awp-dashboard serve --provider-fixtures` (and `actions … --provider-fixtures`) replaces the
network with built-in **synthetic** Google and Microsoft responses and a fixture token. Results
say `mode: "fixture"`. It exists for previews and tests only.
