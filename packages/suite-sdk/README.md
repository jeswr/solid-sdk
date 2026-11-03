<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/suite-sdk

> **Experimental — AI-agent-generated.** Private notification facade; other planned SDK hooks are not implemented.

Mount `PodAuthProvider` from `@jeswr/pod-auth/react`, then use the provider's authenticated
fetch and current actor through the hook:

```ts
import { assignmentAnnounce, useNotify } from '@jeswr/suite-sdk';

const notify = useNotify();
const result = await notify(assignee, assignmentAnnounce(task, tracker, name, title));
```

`notify` is a stable callable until the identity, fetch, or explicit options change. The hook
resets its discovery cache on session changes. Delivery failures return `delivered: false`.
Without a sender WebID or explicit activity actor it returns a `network` failure without sending.
`useNotify({ recipientProtocol })` accepts a resolver for known LWS recipients; do not infer
recipient protocol from the sender's identity. See [pod-access](../pod-access/README.md) for
the result shape, builders, cache behavior, and Node DNS-pinning requirements.

`./testing` re-exports `createNotify` for fixture-fetch tests. Run this package's `lint`, `build`,
`typecheck` and `test` scripts; tests enforce 100% coverage.
