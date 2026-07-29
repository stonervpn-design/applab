# applab — setup

Bringing the custom-build service online. One-time, ~30 minutes. When it's done,
visitors pick apps on the site → a cloud build compiles a firmware with exactly those
apps → they flash it in the browser.

## The pieces

| Repo / service | Visibility | Holds |
| --- | --- | --- |
| `applab-firmware-src` | **private** | the full firmware source + the build workflow + `ci/ext_m5stick_s3.bin` |
| `applab-builds` | **public** | the compiled firmware bins (served over Pages) |
| `applab` | **public** | this site (the app selector) |
| Cloudflare Worker | — | the trigger proxy (holds a token so the site doesn't have to) |

Two tokens are involved — don't mix them up:

- **Token A → starts builds.** Lives in the Worker as `GH_TOKEN`. Needs *Contents: read & write* on **`applab-firmware-src`** (that's what the `repository_dispatch` API requires).
- **Token B → publishes builds.** Lives in `applab-firmware-src` as the secret `BUILDS_REPO_TOKEN`. Needs *Contents: read & write* on **`applab-builds`**.

Both are [fine-grained PATs](https://github.com/settings/tokens?type=beta) — scope each to **only** its one repo.

---

## Steps

### 1. Push the firmware source (private)

Create a **private** repo `applab-firmware-src`, then from your `src_m5stick_s3` folder:

```bash
git init && git add -A && git commit -m "firmware source"
git branch -M main
git remote add origin https://github.com/stonervpn-design/applab-firmware-src.git
git push -u origin main
```

This already includes `.github/workflows/custom-build.yml`, the `FLIPPER_APPS` hook in
`fam_config.py`, and `ci/ext_m5stick_s3.bin`. In the repo, open **Settings → Actions →
General** and make sure Actions are **allowed**.

> The source is private because it contains the private (car-key) material. The build
> workflow **forces the public variant**, so the service can never emit that firmware.

### 2. Create the public builds repo

Create a **public** repo `applab-builds` (can start empty). In it: **Settings → Pages →
Build and deployment → Deploy from a branch → `main` / `root`**. This is where compiled
bins land and get flashed from.

### 3. Wire the workflow's publish step

In **`applab-firmware-src` → Settings → Secrets and variables → Actions**:

- **Variables** tab → New variable: `BUILDS_REPO` = `stonervpn-design/applab-builds`
- **Secrets** tab → New secret: `BUILDS_REPO_TOKEN` = **Token B** (fine-grained PAT,
  *Contents: read & write* on `applab-builds`).

### 4. Smoke-test the build (before any proxy)

In `applab-firmware-src` → **Actions → Custom firmware build → Run workflow**:
`board = m5stack_cardputer_adv`, `apps = nfc,subghz`, `build_id = test1`. Give it ~5–12 min.

Success = `https://stonervpn-design.github.io/applab-builds/builds/test1/manifest.json`
loads. If it does, the hard part works.

### 5. Deploy the trigger proxy

```bash
cd applab-site/proxy
npm i -g wrangler          # or use: npx wrangler
wrangler login
wrangler secret put GH_TOKEN   # paste Token A (Contents:r/w on applab-firmware-src)
wrangler deploy
```

Check `SOURCE_REPO` / `BUILDS_PAGES` / `ALLOWED_ORIGIN` in `proxy/wrangler.toml` match
your repos and site origin first. `wrangler deploy` prints your **Worker URL** — copy it.

### 6. Point the site at the proxy, then publish it

Edit `applab-site/index.html`, find near the top of the script:

```js
const PROXY_URL = "PASTE_YOUR_WORKER_URL_HERE";
```

Replace it with your Worker URL from step 5. Then push the site to a **public** repo
`applab` and enable **Settings → Pages → main / root**:

```bash
cd applab-site
git remote add origin https://github.com/stonervpn-design/applab.git
git push -u origin main
```

Live at `https://stonervpn-design.github.io/applab/`.

---

## Verify end-to-end

Open the site → tick a few apps → pick a board → **Build my firmware**. You should see the
compiling state, then a **Flash now** button. Plug the board in (Chrome/Edge, desktop),
flash, and confirm the menu only has the apps you chose.

## Troubleshooting

- **Build modal says "not connected"** — `PROXY_URL` is still the placeholder (step 6).
- **Proxy returns 502 / dispatch failed** — Token A is missing *Contents: write* on
  `applab-firmware-src`, or `SOURCE_REPO` is wrong.
- **Action runs but publish step fails** — `BUILDS_REPO_TOKEN` / `BUILDS_REPO` not set
  (step 3), or Token B lacks write on `applab-builds`.
- **Manifest never appears** — Pages isn't enabled on `applab-builds` (step 2), or the
  build itself failed (check the Action log).
- **Flash button says "use Chrome/Edge"** — Web Serial only works in Chromium browsers on
  desktop, over https (both Pages sites are https, so this is just the browser).
- **Builds getting spammed** — add a Cloudflare **Rate Limiting** rule on the Worker
  (see `proxy/README.md`).

## Updating

- **Add/rename an app** — edit the `APPS` array in `index.html` (each entry's `id` is the
  firmware appid). Re-push `applab`.
- **New firmware fixes** — just push the source repo; the next custom build picks them up.
- **The `/ext` image** — only needs regenerating if the m5stick `sd_content` (NFC dicts,
  gate keys) changes; re-extract the `storage` region (`0x390000`, size `0x460000`) from a
  fresh public merged bin into `ci/ext_m5stick_s3.bin`.
