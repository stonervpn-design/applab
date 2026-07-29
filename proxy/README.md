# applab build-trigger proxy

A tiny Cloudflare Worker (free tier) that lets the static applab site start a custom
firmware build without exposing a GitHub token. It validates the request, mints a
build id server-side, and fires the `custom-build` `repository_dispatch` on the private
source repo.

## Deploy

```bash
npm i -g wrangler          # or: npx wrangler ...
cd proxy
wrangler login             # authorize Cloudflare (one time)

# the GitHub token is a SECRET — never put it in wrangler.toml:
wrangler secret put GH_TOKEN
#   paste a fine-grained PAT scoped to ONLY the source repo,
#   with permission:  Contents = Read and write   (needed to trigger dispatches)

wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g.
`https://applab-build-proxy.<your-subdomain>.workers.dev` — that URL goes into the
applab site (Phase 3) as the build endpoint.

## Configure

Edit `wrangler.toml` `[vars]` to match your repos:

- `SOURCE_REPO` — the private firmware repo the Action lives in.
- `BUILDS_PAGES` — Pages host of the public builds repo (`user.github.io/applab-builds`).
- `ALLOWED_ORIGIN` — exact origin of the applab site, so only it can call the proxy.

## Contract

`POST` JSON `{ "board": "m5stack_cardputer_adv", "apps": "nfc,subghz,doom" }`
→ `200 { "ok": true, "build_id": "b…", "manifest": "https://…/builds/b…/manifest.json" }`

The site then polls that `manifest` URL until the Action publishes it (~5–12 min),
then flashes it with ESP Web Tools.

## Hardening (optional, later)

- Add a Cloudflare **Rate Limiting** rule (e.g. 5 builds / 10 min / IP) so the build
  minutes can't be spammed.
- Or gate with a Turnstile token check before dispatching.
