<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# CON-01 conservative readings

1. DESIGN §2 D1 lists `./node` and a testing recorder, while tasks.json assigns the CLI to
   CON-03 and recorder to CON-02. Options: implement those later tasks now, or reserve the
   entry points with existing functionality. Chosen: `./node` exports host-neutral runner
   and writer primitives; `./testing` exports the existing fixtures/memory Pod. CLI and
   recorder remain with their assigned tasks.
2. DESIGN §2 D1 asks for `./adapters/<id>` but Garmin has both OAuth and file adapters.
   Options: export only OAuth, or both from that subpath. Chosen: both, preserving the
   existing names. Other ids export their existing OAuth or file adapter.
3. DESIGN §2 D2 names port methods without signatures. Options: introduce a new adapter
   context shape, or preserve the current context and adapt it to explicit host ports.
   Chosen: preserve ImportContext/types exports; PodWriter retains ETags on read, accepts
   conditional writes and batches Type Index registrations after the import. SourceAuth
   supplies an already authenticated source fetch. Pod Manager injects both at call time.
4. DESIGN §2 D2 requires source/storage separation without prescribing credentialed
   source URL policy. Options: require new origin metadata on every adapter, or bind the
   helper to existing static fixture-route origins with a host override. Chosen: use that
   fixed allowlist, reject foreign/userinfo URLs, and refuse all source redirects. Runner
   read ETags stay internal and guard later writes, preserving existing read return values.
