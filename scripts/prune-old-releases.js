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

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) { console.error("[prune] no GH_TOKEN / GITHUB_TOKEN — skipping."); process.exit(0); }
const owner = process.env.GH_OWNER || "Tarnholm";
const repo  = process.env.GH_REPO  || "manipula";
const keep  = Number(process.env.KEEP || 3);

function gh(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method, hostname: "api.github.com", path: pathname,
      headers: {
        Authorization: "token " + token,
        "User-Agent": "manipula-prune",
        Accept: "application/vnd.github+json",
      },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => buf += c);
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`${method} ${pathname} → ${res.statusCode}: ${buf}`));
        if (!buf) return resolve(null);
        try { resolve(JSON.parse(buf)); } catch { resolve(null); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  try {
    const rels = await gh("GET", `/repos/${owner}/${repo}/releases?per_page=100`);
    const nonDraft = (rels || []).filter((r) => !r.draft).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const toDelete = nonDraft.slice(keep);
    if (!toDelete.length) {
      console.log(`[prune] nothing to delete (${nonDraft.length} non-draft releases, keeping ${keep}).`);
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
