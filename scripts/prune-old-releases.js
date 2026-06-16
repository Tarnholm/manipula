// scripts/prune-old-releases.js — keep the latest N GitHub releases
// (default 3) and delete the rest, plus their git tags. Run after a
// successful electron-builder publish so the releases page stays
// tidy and old assets stop accumulating.
//
// Usage:
//   GH_TOKEN=... node scripts/prune-old-releases.js
// Env:
//   GH_TOKEN | GITHUB_TOKEN — repo-scoped token (the same one
//                              electron-builder uses to publish).
//   KEEP                    — how many recent releases to keep
//                              (default 3).
//   GH_OWNER, GH_REPO       — defaults to Tarnholm / manipula.
const https = require("https");

// Trim defends against a trailing newline/space sneaking in from the env
// (a stray "\r" makes "token <PAT>\r" and GitHub answers 401 Bad credentials).
const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
if (!token) { console.error("[prune] no GH_TOKEN / GITHUB_TOKEN — skipping."); process.exit(0); }
const owner = process.env.GH_OWNER || "Tarnholm";
const repo  = process.env.GH_REPO  || "manipula";
const keep  = Number(process.env.KEEP || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statuses worth retrying: GitHub occasionally returns a transient 401
// "Bad credentials" right after the release-creation API burst (this whole
// script runs seconds after electron-builder hammers the API), plus the
// usual rate-limit / server-side blips.
const RETRYABLE = new Set([401, 403, 429, 500, 502, 503, 504]);

function ghOnce(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method, hostname: "api.github.com", path: pathname,
      headers: {
        // Bearer is the modern form and works for both classic (ghp_) and
        // fine-grained PATs; legacy "token <PAT>" still works but Bearer is
        // the documented default.
        Authorization: "Bearer " + token,
        "User-Agent": "manipula-prune",
        Accept: "application/vnd.github+json",
      },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => buf += c);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const err = new Error(`${method} ${pathname} → ${res.statusCode}: ${buf}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        if (!buf) return resolve(null);
        try { resolve(JSON.parse(buf)); } catch { resolve(null); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Retry transient failures up to 3 attempts with linear backoff (1s, 2s).
async function gh(method, pathname, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await ghOnce(method, pathname);
    } catch (e) {
      lastErr = e;
      const retryable = e.statusCode == null || RETRYABLE.has(e.statusCode);
      if (i < attempts && retryable) {
        console.warn(`[prune] ${method} ${pathname} failed (attempt ${i}/${attempts}): ${e.message.slice(0, 120)} — retrying in ${i}s`);
        await sleep(i * 1000);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

(async () => {
  try {
    const rels = await gh("GET", `/repos/${owner}/${repo}/releases?per_page=100`);
    // Count ALL releases by recency (newest first) — the release we just
    // published is still a DRAFT at this point, so filtering it out would
    // keep `keep` published PLUS the new one (= keep+1 after un-drafting).
    // Including everything keeps the newest `keep` (the new draft among them)
    // and also cleans up stale leftover drafts.
    const all = (rels || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const toDelete = all.slice(keep);
    if (!toDelete.length) {
      console.log(`[prune] nothing to delete (${all.length} releases, keeping ${keep}).`);
      return;
    }
    console.log(`[prune] keeping ${keep} latest, deleting ${toDelete.length} older releases.`);
    for (const r of toDelete) {
      try {
        await gh("DELETE", `/repos/${owner}/${repo}/releases/${r.id}`);
        console.log(`  deleted release ${r.tag_name}`);
      } catch (e) { console.warn(`  release delete failed ${r.tag_name}:`, e.message); }
      try {
        await gh("DELETE", `/repos/${owner}/${repo}/git/refs/tags/${r.tag_name}`);
        console.log(`  deleted tag     ${r.tag_name}`);
      } catch (e) { /* tag may already be gone */ }
    }
  } catch (e) {
    console.warn("[prune] failed:", e.message);
  }
})();
