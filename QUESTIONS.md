<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DRV-L5 contract questions

1. What identifies a file across moves, and how are replayed or simultaneous events ordered?
   (13-pure-libraries-5; DRV-L5 task; 04-drive §5.1.) Options: infer identity from URL aliases,
   or require stable file IDs and explicit source/destination URLs. Conservative implementation:
   require stable `fileId`, unique event `id`, actor URL, epoch-millisecond `at`, resource/container
   kind, and `fromUrl` on moves. Exact replay is idempotent; conflicting IDs fail. Sort by time,
   retaining stream order for ties. Partial histories may start with any event; subsequent stale
   URLs, kind changes, duplicate creates and events after deletion fail. A reused URL needs a new
   file ID. Folder moves require explicit child events; no prefix rewriting is inferred.
2. Which calendar and time zone define day groups? (04-drive §2.3; DRV-L5 task.) Options: host
   defaults, UTC, or caller-selected zone. Conservative implementation: require an explicit Intl
   time zone and return Gregorian YYYY-MM-DD groups; presentation labels belong to the UI. Recent
   excludes deleted resources and containers, defaults to 50 items and accepts limits 0–50.
3. How should stars follow a URL-changing move? (04-drive §4.8, §5.1, §5.2.) Options: infer from
   historical URLs, or apply an explicit move to the stored URL set. Conservative implementation:
   immutable add/remove/toggle and explicit `moveStar(fromUrl, toUrl)`; no implicit deletion of stars.
