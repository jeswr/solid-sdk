<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# Deploy — the Solid App Store as the 10th pod-app subdomain

> **Documentation only.** This file records the recipe; it does **not** run anything. Deploys to
> the live box run from the suite's main orchestrating session, never from a sub-agent, and only
> after the DNS A record below exists (a `needs:user` item). The recipe mirrors the pod-apps
> runbook in `prod-solid-server/deploy/POD-APPS.md` exactly, adding one subdomain.

The store is a pure static SPA (Vite, `web/` → `web/dist`), served additively by the existing
`podapps` container behind the main edge Caddy — identical to the other 9 pod-apps, plus a small
`Accept`-routing block so the catalog IRI content-negotiates Turtle / JSON-LD / HTML.

```
client (HTTPS) ─▶ main Caddy (TLS + Let's Encrypt, Caddyfile.single)
                    │  apps.<PSS_DOMAIN> vhost → reverse_proxy podapps:8080
                    ▼
                  podapps container (caddy:2-alpine, internal :8080, file_server)
                    │  host @appstore → /srv/podapps/app-store
                    │  Accept-routed: /catalog → catalog.ttl | catalog.jsonld | index.html
                    ▼
                  static dist/  (Vite SPA + generated catalog.ttl/.jsonld, built on-box)
```

## 1. DNS — `needs:user`

Add one A record for the subdomain pointing at the box's public IP (currently `35.179.26.2`), so
the main Caddy obtains a per-subdomain Let's Encrypt cert on first request (HTTP-01, matching the
other 9):

```
apps.<PSS_DOMAIN>   A   <box public IP>      # apps.solid-test.jeswr.org → 35.179.26.2
```

## 2. Build on the box (the host has no Node)

Build inside `node:24-alpine`, with `APP_ORIGIN` set to the exact public origin so `gen-clientid.mjs`
emits the per-origin Client Identifier Document **and** `gen-catalog.mjs` stamps the catalog IRIs:

```sh
SUB=apps.solid-test.jeswr.org
git clone --depth 1 https://github.com/jeswr/solid-app-store /tmp/build-app-store

docker run --rm \
  -v /tmp/build-app-store:/src -w /src/web \
  -e APP_ORIGIN=https://$SUB \
  node:24-alpine \
  sh -c 'npm ci || (rm -f package-lock.json && npm install) && npm run build'

sudo rm -rf /srv/podapps/app-store && sudo mkdir -p /srv/podapps/app-store
sudo cp -r /tmp/build-app-store/web/dist/. /srv/podapps/app-store/
```

The `build` script runs `gen-clientid.mjs && gen-catalog.mjs && vite build`, so `web/dist/` ends up
with `index.html`, hashed assets, `clientid.jsonld`, `callback.html`, `catalog.ttl`, and
`catalog.jsonld` — all stamped with `https://apps.solid-test.jeswr.org`.

## 3. The podapps container handler (`Caddyfile.podapps`)

Add an `@appstore` handler alongside the existing 9, plus the catalog Content-Type +
`Accept`-routing block. The `@clientid` content-type override already in that file covers the store's
own `/clientid.jsonld` too.

```caddy
	@appstore host apps.solid-test.jeswr.org
	handle @appstore {
		# Content negotiation for the ONE catalog IRI (/catalog): RDF clients get
		# Turtle/JSON-LD; an explicit text/html request gets the SPA (which deep-links to
		# the #/catalog HTML view). A bare */* and Accept: text/turtle fall through to RDF.
		@catalog_jsonld {
			path /catalog
			header Accept *application/ld+json*
		}
		handle @catalog_jsonld {
			root * /srv/podapps/app-store
			rewrite * /catalog.jsonld
			header Content-Type application/ld+json
			file_server
		}
		@catalog_html {
			path /catalog
			header Accept *text/html*
		}
		handle @catalog_html {
			root * /srv/podapps/app-store
			rewrite * /index.html
			file_server
		}
		@catalog_ttl path /catalog
		handle @catalog_ttl {
			root * /srv/podapps/app-store
			rewrite * /catalog.ttl
			header Content-Type text/turtle
			file_server
		}

		# SPA fallback (mutually exclusive with the /catalog handles above). This is the
		# sibling pod-app handler form — root + try_files {path} /index.html + file_server —
		# wrapped in a bare `handle {}` so the matched-above /catalog requests do NOT also
		# fall through here (Caddy `handle` blocks at one level are mutually exclusive; bare
		# terminal directives are NOT, so the SPA fallback MUST itself be a `handle {}`).
		# The directly-fetched LD files (/catalog.ttl, /catalog.jsonld) are served here, so
		# their Content-Type overrides live in this same handle.
		handle {
			root * /srv/podapps/app-store
			@catalog_files path /catalog.ttl
			header @catalog_files Content-Type text/turtle
			@catalog_jsonld_file path /catalog.jsonld
			header @catalog_jsonld_file Content-Type application/ld+json
			try_files {path} /index.html
			file_server
		}
	}
```

> Caddy `handle` semantics: `handle` blocks at the same nesting level are **mutually exclusive**
> (only the first matching one runs), so the SPA fallback is its own bare `handle {}` rather than
> bare `try_files`/`file_server` directives — otherwise a matched `/catalog` request would run its
> catalog handle *and* fall through to the SPA file_server (double-handling). This is the canonical
> Caddy SPA-with-extra-routes pattern, and structurally identical to each sibling pod-app block (a
> single self-contained `handle @app { root *; try_files {path} /index.html; file_server }`), just
> with the `/catalog` content-negotiation handles added. Keep this handler's hostname in lockstep
> with the vhost below.

## 4. The main-Caddy vhost (`Caddyfile.single`)

Add one vhost (copy of the pod-app block):

```caddy
apps.{$PSS_DOMAIN} {
	reverse_proxy podapps:8080
}
```

Reload the main Caddy after editing
(`docker compose … exec caddy caddy reload --config /etc/caddy/Caddyfile`).

## 5. Verify

```sh
curl -sI https://apps.solid-test.jeswr.org/                      # 200, the SPA
curl -s  -H 'Accept: text/turtle'        https://apps.solid-test.jeswr.org/catalog | head
curl -s  -H 'Accept: application/ld+json' https://apps.solid-test.jeswr.org/catalog | head
curl -sI https://apps.solid-test.jeswr.org/clientid.jsonld       # Content-Type: application/ld+json
```

## Open items (`needs:user`)

- **DNS** — the `apps.solid-test.jeswr.org` A record (above).
- **Go-live consent** for the 7 currently-gated apps (the 6 finance products + the FDC3 demo). The
  store lists them as **"Coming soon"** (no Launch, repo link only) until consent — confirm that
  treatment vs hiding them.
- **Publisher WebID** — `gen-catalog.mjs` stamps a placeholder `https://id.jeswr.org/me` as
  `dct:publisher` / `foaf:maker`; confirm the canonical WebID.
