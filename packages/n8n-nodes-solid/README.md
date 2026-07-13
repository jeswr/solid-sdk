<!-- AUTHORED-BY Codex GPT-5 -->

# n8n-nodes-solid

An n8n community node for scoped LDP reads and writes against a Solid pod.

> Experimental. The initial credential uses a bearer access token; keep it masked in n8n and scope
> it narrowly. Per-request DPoP support is a future credential design.

## Install

Until npm publishing is available, run this in the n8n custom-nodes directory:

```sh
npm install github:jeswr/n8n-nodes-solid#main
```

After publication, install `n8n-nodes-solid` from **Settings → Community Nodes**. Requires Node.js
22.19 or newer and n8n workflow APIs from the declared peer range.

## Minimal usage

1. Create **Solid Pod (OIDC / Bearer) API** credentials with a pod base URL and access token.
2. Add the **Solid** node to a workflow.
3. Choose **Resource** or **Container**, select an operation, and enter a target below the pod base.
4. For writes, provide content and a content type; use an ETag with Update for a conditional write.

Targets may be absolute URLs inside the base or paths relative to it. Traversal, ambiguous encoded
delimiters, cross-origin URLs, and redirects are refused before credentials can leave the scope.

## Key operations

- Resource Read: returns body, content type, and ETag.
- Resource Create: `PUT` with `If-None-Match: *`.
- Resource Update: overwrite or optional `If-Match` conditional write.
- Resource Delete: reports missing resources without crashing the workflow.
- Container List: parses `ldp:contains` and emits one n8n item per member.

## Links

- [Source](https://github.com/jeswr/n8n-nodes-solid)
- [Issues](https://github.com/jeswr/n8n-nodes-solid/issues)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
