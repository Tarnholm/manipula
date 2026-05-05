// Remove previous installer artifacts before electron-builder writes a new one.
// Run from the dist:win npm script. Without this, dist/ accumulates one
// 109MB exe + blockmap per release — at 0.19.19, that's already 1.5GB of
// stale builds nobody is going to install.
//
// Only deletes Manipula Setup *.exe / *.exe.blockmap. Leaves win-unpacked/,
// latest.yml, .updaterId, etc. intact since electron-builder needs to
// re-emit those anyway and clobbering them is harmless if it does.

const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
if (!fs.existsSync(distDir)) process.exit(0);

const re = /^Manipula Setup .+\.exe(\.blockmap)?$/;
let removed = 0;
for (const name of fs.readdirSync(distDir)) {
  if (!re.test(name)) continue;
  try {
    fs.unlinkSync(path.join(distDir, name));
    removed++;
  } catch (e) {
    console.warn(`[clean-dist] failed to remove ${name}: ${e.message}`);
  }
}
if (removed) console.log(`[clean-dist] removed ${removed} previous installer artifact(s)`);
