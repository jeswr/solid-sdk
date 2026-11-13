<!-- AUTHORED-BY Claude Opus 5.5 -->
# Errand: consumer agent app

`@jeswr/app-agent-chat` is a chat app for a personal agent that buys things, shares
data and applies for things on your behalf. Every action runs through the outbound gate in
`@jeswr/agent-consent`. You approve or refuse through approval sheets. A spending limit lets
the agent buy without asking, and you can set one per purchase, as a weekly or monthly
budget, or as an allowance.

The design of record is `consumer-agent/design.md` in the project files. Everything in the
demo is fictional: Sam, the stores, the banks and the products.

## Demo flows

1. Search for sneakers. The store page hides an instruction to add a protection plan. The
   agent refuses it because page text can inform it but never instruct it.
2. Choose a pair, then **Set a spending limit** ($100 a month at that store, chips, period,
   scope, cap and expiry). The limit is signed with this device's key.
3. Reorder socks: inside the limit, so the agent buys without asking.
4. Ask for a jacket: over the limit, so the agent offers **Just this once**, **Raise limit** or **Not now**.
5. Get a mortgage decision in principle: compare lenders, approve exactly which data goes to
   the lender (the gate withholds what the purpose does not need), pass a simulated face
   check, and receive a signed, non-binding decision.

**What it can do** lists every rule, with meters and hold-to-turn-off. **Activity** keeps
each decision with its checks, digest and signed consent record. **Accounts** reserves a
place for the sign-in and password-manager connector, which is built separately.

## Modes

- Built-in demo (default): a scripted core that needs no model and no network.
- Live model: when the page runs as a claude.ai artifact with the `sample` capability, the
  composer can switch to Claude, which plans through the same tools. The gate still decides.

## Commands

```bash
pnpm --filter @jeswr/app-agent-chat dev
pnpm --filter @jeswr/app-agent-chat test       # engine scenarios (vitest)
PW_CHROMIUM=/path/to/chrome pnpm --filter @jeswr/app-agent-chat test:e2e
pnpm --filter @jeswr/app-agent-chat build:artifact   # one self-contained file in dist-artifact/
```
