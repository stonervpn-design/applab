#!/usr/bin/env python3
"""
Post an applab CATALOG changelog to the webhook when the app catalog changes.

Runs in GitHub Actions on push: it diffs the `const APPS = [...]` array in
index.html between the pushed commits (before -> after) and, if apps were added /
removed / renamed, POSTs a summary to the webhook.

The webhook URL comes from the WEBHOOK_URL env var (a GitHub Actions secret), so
it is never committed. Falls back to tools/.webhook_url for local testing.

Usage:
  python tools/catalog_changelog.py --git <before_sha> <after_sha>   # CI
  python tools/catalog_changelog.py --test                           # local labeled test
"""
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
INDEX = os.path.join(ROOT, "index.html")
URL_FILE = os.path.join(HERE, ".webhook_url")
ZERO = "0000000000000000000000000000000000000000"


def read_url():
    env = os.environ.get("WEBHOOK_URL", "").strip()
    if env:
        return env
    if os.path.exists(URL_FILE):
        return open(URL_FILE, encoding="utf-8").read().strip()
    sys.exit("no webhook: set WEBHOOK_URL env (CI secret) or tools/.webhook_url")


def parse_apps(text):
    """Return {appid: display_name} from a const APPS = [...] block, or None."""
    if not text:
        return None
    m = re.search(r"const\s+APPS\s*=\s*\[(.*?)\];", text, re.DOTALL)
    if not m:
        return None
    apps = {}
    for entry in re.finditer(r"\{[^{}]*?\}", m.group(1)):
        body = entry.group(0)
        idm = re.search(r"\bid:\s*'([^']+)'", body)
        if not idm:
            continue
        nm = re.search(r"\bn:\s*'([^']*)'", body)
        apps[idm.group(1)] = nm.group(1) if nm else idm.group(1)
    return apps


def git_show_index(rev):
    try:
        r = subprocess.run(
            ["git", "show", f"{rev}:index.html"],
            cwd=ROOT, capture_output=True, text=True, timeout=30)
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


def working_index():
    try:
        return open(INDEX, encoding="utf-8").read()
    except Exception:
        return ""


def post(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Content-Type": "application/json",
            # Cloudflare 403s the default python-urllib UA; send a normal one.
            "User-Agent": "applab-catalog-changelog/1.0",
        })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")[:200]


def emit(old, new, test=False):
    added = sorted(a for a in new if a not in old)
    removed = sorted(a for a in old if a not in new)
    renamed = sorted(a for a in new if a in old and old[a] != new[a])

    if not (added or removed or renamed) and not test:
        print("catalog unchanged - not posting.")
        return 0

    parts = []
    if added:
        parts.append("Added: " + ", ".join(f"{new[a]} ({a})" for a in added))
    if removed:
        parts.append("Removed: " + ", ".join(f"{old[a]} ({a})" for a in removed))
    if renamed:
        parts.append("Renamed: " + ", ".join(f"{old[a]} -> {new[a]} ({a})" for a in renamed))
    if test and not parts:
        parts.append(f"{len(new)} apps in catalog")

    ts = datetime.datetime.now().isoformat(timespec="seconds")
    title = "applab catalog update" + (" (test)" if test else "")
    content = (f"**{title}** — stonervpn-design.github.io/applab/#catalog\n"
               f"{ts}\n" + "\n".join(f"- {p}" for p in parts))
    payload = {
        "content": content, "text": content, "source": "applab-catalog",
        "added": added, "removed": removed, "renamed": renamed,
        "app_count": len(new), "timestamp": ts, "test": test,
    }
    try:
        status, resp = post(read_url(), payload)
        print(f"catalog webhook POST -> HTTP {status}  {resp}")
        return 0 if 200 <= status < 300 else 2
    except Exception as exc:
        print(f"catalog webhook POST failed: {exc}")
        return 1


def main():
    args = sys.argv[1:]
    if "--test" in args:
        new = parse_apps(working_index())
        if new is None:
            sys.exit("could not parse APPS from index.html")
        return emit({}, new, test=True)

    if "--git" in args:
        i = args.index("--git")
        before = args[i + 1] if i + 1 < len(args) else ""
        after = args[i + 2] if i + 2 < len(args) else "HEAD"
        # First push / new branch: no comparable base -> seed silently.
        if not before or before == ZERO:
            print("no base commit (first push) - not posting.")
            return 0
        old = parse_apps(git_show_index(before))
        new = parse_apps(git_show_index(after)) or parse_apps(working_index())
        if old is None or new is None:
            print("could not parse catalog on one side - not posting.")
            return 0
        return emit(old, new)

    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
