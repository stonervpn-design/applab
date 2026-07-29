# applab — app catalog for the M5Stack ESP32-S3 Flipper ports

A self-hosted catalog for the **M5Stack StickS3** and **Cardputer ADV** firmware, with
**one-click in-browser flashing** via [ESP Web Tools](https://esphome.github.io/esp-web-tools/).

Single `index.html` — no build step, no backend.

## How the flashing works

The **Flash** buttons are `<esp-web-install-button>` elements that point straight at your
existing web-flasher manifests:

- StickS3 → `https://stonervpn-design.github.io/m5stick-s3-flipper-webflasher/manifest.json`
- Cardputer → `https://stonervpn-design.github.io/cardputer-adv-flipper-webflasher/manifest.json`

GitHub Pages serves those with `Access-Control-Allow-Origin: *`, so the catalog flashes them
cross-origin. **Firmware is never duplicated here** — when you push a new bin to a
web-flasher repo and bump its `manifest.json`, this catalog flashes the new version
automatically. Nothing to update on this side.

Flashing needs a Chromium browser (Chrome/Edge) on desktop, served over HTTPS (GitHub Pages
is). Non-supported browsers see a "use Chrome/Edge" note instead of the button.

## Deploy (GitHub Pages)

```bash
# from this folder (a git repo is already initialised)
gh repo create stonervpn-design/applab --public --source . --remote origin --push
# ...or manually: create an empty repo named "applab" on github.com, then:
#   git remote add origin https://github.com/stonervpn-design/applab.git
#   git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / root**.
It goes live at `https://stonervpn-design.github.io/applab/` within a minute.

## Updating the catalog

- **Apps** — edit the `APPS` array in `index.html` (name, category `c`, description `d`).
  Categories live in `CATS`. That's the whole content model.
- **Firmware versions** — the `ver` strings in the `BOARDS` array are cosmetic labels;
  the actual bin flashed always comes from the live manifest.
- **A new board** — add an entry to `BOARDS` with its own `manifest` URL.

## Notes

- Community Flipper-firmware ports for ESP32-S3. Not affiliated with Flipper Devices or M5Stack.
- The **Cardputer has no PSRAM**, so apps are compiled into the firmware (one flash = the
  whole set) rather than installed individually.
- For authorized security testing, education, and hardware you own.
