<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Link Signal and WhatsApp to the hosted Matrix bridges

This is the operator runbook for using A-028's hosted mautrix bridges with A-044.
Run these steps manually with the account owner's consent. The SDK does not perform
device linking. The A-028 deployment inventory is not included in this checkout:
obtain the HTTPS homeserver origin, Signal/WhatsApp bridge bot MXIDs and expected
ghost namespace from its operator. The `bridge.example` names in tests are fixtures.

## Before linking

1. Sign in to the intended Matrix account using a trusted Matrix client. Verify the
   full hosted bot MXIDs against the deployment inventory; display names are not
   identity checks. Confirm the account is permitted by the hosted bridge operator.
2. Have the existing Signal or WhatsApp mobile account available. The hosted bridge
   becomes a linked device and processes plaintext at the bridge boundary; native
   app encryption does not create end-to-end encryption through the agent.
3. Keep QR codes, pairing codes, device secrets, Matrix tokens and crypto stores out
   of source control, logs, issue reports and screenshots shared with others.
   Provision the agent's Matrix device through the existing A-027 credential path;
   linking a bridge does not replace separate read/send grants or owner approval.

## Signal

1. Start a private Matrix chat with the configured Signal bot (upstream's usual
   localpart is `signalbot`; use the hosted deployment's actual MXID).
2. Open Signal on the phone, then Settings → Linked devices → add a device.
3. Send `login` to the bot and scan its QR code from Signal. If it expires, begin a
   fresh login. Confirm the bot reports success and the new linked device appears
   on the phone.
4. If offered a history transfer, choose the minimum history appropriate for the
   account. Otherwise rooms appear as new messages arrive. Linking is not approval
   to import historical conversations.

These steps follow the upstream [mautrix Signal authentication instructions](https://docs.mau.fi/bridges/go/signal/authentication.html).

## WhatsApp

1. Start a private Matrix chat with the configured WhatsApp bot (upstream's usual
   localpart is `whatsappbot`).
2. Send `login qr`. In WhatsApp on the phone, open Settings/Menu → Linked devices
   and link a device by scanning the bot's QR code.
3. If QR scanning is unavailable, upstream supports `login phone`: follow the bot's
   prompts, then choose “Link with a phone number instead” on the phone and enter
   the one-time pairing code. Complete any verification requested by WhatsApp.
4. Wait for the bot's success response and verify the linked device on the phone.
   Rooms/history may be populated by the hosted bridge's configured backfill.

These steps follow the upstream [mautrix WhatsApp authentication instructions](https://docs.mau.fi/bridges/go/whatsapp/authentication.html).

## Connect a portal to the agent

1. Use a consenting test contact and exchange a harmless message through the mobile
   app and Matrix client. Check the portal room ID and its `m.bridge` state
   (`content.protocol.id` must be `signal` or `whatsapp`; older hosts may use
   `uk.half-shot.bridge`). Check incoming ghost MXIDs or the hosted double-puppet
   configuration. Names and bridge state are discovery hints, not agent identity.
2. Mark only the intended private portal as a direct room in the Matrix account's
   `m.direct` data. The reader retains A-027's DM allowlist; group portals and bridge
   management chats are not automatically included.
3. Pin the recipient actor to that exact room in `recipients`, and pin the room to
   its channel in `bridgeRooms`. Advertise `describeMatrixBridge(channel, state)`
   and render with the matching footer profile. Keep the agent in dry-run while
   inspecting the exact human summary and URL footer for owner approval.
4. Confirm the portal is unencrypted before enabling approved sends. This binding
   refuses `m.room.encryption`, including encrypted bridge portals; do not remove
   encryption from an existing room to bypass the refusal. Use a separately
   approved supported portal or leave sending disabled.
5. Enable real sends only through the executor's existing current mandate, limits
   and exact-wire owner-approval checks. Matrix acceptance is not remote delivery
   evidence. Check the mobile app separately during the authorized commissioning
   exchange; do not turn uncertain sends into automatic retries.

## Disconnect, relink and troubleshoot

- Disable the executor's send authority first. Remove the hosted bridge device
  from Signal/WhatsApp's linked-device list and confirm disconnection. Follow the
  hosted operator's logout/session-cleanup procedure, including any retained
  backfill data. Revoke the Matrix device separately when retiring the agent.
- For a failed link, check the full bot MXID and account access with the operator,
  then request a fresh login. Do not reuse expired QR/pairing codes or paste tokens
  into a management chat.
- After relinking or a host upgrade, recheck the portal ID, bridge protocol and
  trusted pins before approving another send. A changed or unreadable bridge state
  requires operator resolution and a fresh review of the rendered wire.
- For limited timelines, decryption errors or conflicting bridge state, retain the
  previous cursor. Resolve history/keys/state with the operator; do not skip ahead.
  Custom ghost templates require usable bridge state for channel classification.
