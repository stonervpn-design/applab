// applab build-trigger proxy (Cloudflare Worker)
//
// The static applab site can't hold a GitHub token, so it POSTs here instead.
// This Worker validates the request, generates a build id (server-side, so the
// client can never inject a path), and fires a repository_dispatch that starts
// the "Custom firmware build" Action on the private source repo.
//
// Secrets / vars (set with `wrangler secret put` and in wrangler.toml [vars]):
//   GH_TOKEN       (secret) — fine-grained PAT that can trigger workflows on the
//                             source repo (Contents: read+write on SOURCE_REPO).
//   SOURCE_REPO    (var)    — "stonervpn-design/applab-firmware-src"
//   BUILDS_PAGES   (var)    — "stonervpn-design.github.io/applab-builds"
//   ALLOWED_ORIGIN (var)    — "https://stonervpn-design.github.io"  (CORS lock)

const BOARDS = new Set(["m5stick_s3", "m5stack_cardputer_adv", "lilygo_t_embed_cc1101"]);
const MAX_APPS_LEN = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // Flash/download counter (KV-backed). GET reads it; POST bumps it. Best-effort:
    // if the KV binding isn't present the count is reported as 0 and never errors.
    if (url.pathname === "/count") {
      const key = "flashes";
      if (!env.COUNTER) return json({ count: 0 }, 200, cors);
      if (request.method === "POST") {
        const n = (parseInt(await env.COUNTER.get(key), 10) || 0) + 1;
        await env.COUNTER.put(key, String(n));
        return json({ count: n }, 200, cors);
      }
      return json({ count: parseInt(await env.COUNTER.get(key), 10) || 0 }, 200, cors);
    }

    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Body must be JSON." }, 400, cors); }

    const board = String(body.board || "");
    if (!BOARDS.has(board)) return json({ error: "Unknown board." }, 400, cors);

    // apps: appid-safe chars + commas only; de-dupe; SORT (same selection in any
    // order -> same build); cap length.
    const apps = [...new Set(
      String(body.apps || "")
        .split(",")
        .map((a) => a.replace(/[^a-zA-Z0-9_-]/g, ""))
        .filter(Boolean)
    )].sort().join(",").slice(0, MAX_APPS_LEN);

    // Deterministic build id: the same (board, apps, firmware source) reuses the same
    // output path, so a repeat request is served from the existing build with no
    // recompile. The source's latest commit is folded in, so a firmware update
    // invalidates the cache. If the source version can't be read, fall back to a
    // random id (correct, just uncached).
    const srcVer = await sourceVersion(env);
    let build_id, deterministic = false;
    if (srcVer) {
      build_id = "c" + (await sha256hex(`${board}|${apps}|${srcVer}`)).slice(0, 20);
      deterministic = true;
    } else {
      build_id = "b" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    }
    const manifestUrl = `https://${env.BUILDS_PAGES}/builds/${build_id}/manifest.json`;

    // Already built for this exact selection + source? Serve it, skip the build.
    if (deterministic) {
      try {
        const head = await fetch(`${manifestUrl}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
        if (head.ok) {
          return json({ ok: true, build_id, manifest: manifestUrl, cached: true }, 200, cors);
        }
      } catch (e) { /* fall through and build */ }
    }

    const gh = await fetch(`https://api.github.com/repos/${env.SOURCE_REPO}/dispatches`, {
      method: "POST",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "custom-build",
        client_payload: { board, apps, build_id },
      }),
    });

    if (!gh.ok) {
      const detail = (await gh.text()).slice(0, 300);
      return json({ error: "Couldn't start the build.", status: gh.status, detail }, 502, cors);
    }

    // Build dispatched. Hand back the id + where the result will appear.
    return json({ ok: true, build_id, manifest: manifestUrl, cached: false }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "applab-proxy",
  };
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sourceVersion(env) {
  // Latest commit sha (short) of the firmware source's default branch, used as the
  // cache-busting part of the deterministic build id. Best-effort: null on any error.
  try {
    const r = await fetch(
      `https://api.github.com/repos/${env.SOURCE_REPO}/git/refs/heads/main`,
      { headers: ghHeaders(env) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const sha = j && j.object && j.object.sha ? j.object.sha : "";
    return sha.slice(0, 12) || null;
  } catch (e) {
    return null;
  }
}
