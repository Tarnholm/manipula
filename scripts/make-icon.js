// scripts/make-icon.js — render public/icon.svg into the Windows .ico + a 256×256 .png
// favicon. Run via `node scripts/make-icon.js`. Outputs:
//   public/icon.ico   (multi-size 16/32/48/64/128/256 — used by electron-builder for the
//                     installer, app shortcut, and taskbar icon)
//   public/icon.png   (256×256 — used as the React favicon)

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const SVG = path.join(__dirname, "..", "public", "icon.svg");
const OUT_ICO = path.join(__dirname, "..", "public", "icon.ico");
const OUT_PNG = path.join(__dirname, "..", "public", "icon.png");
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svgBuffer = fs.readFileSync(SVG);
  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(svgBuffer, { density: 320 })
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer();
    pngs.push(buf);
    console.log(`  rendered ${size}×${size}`);
  }
  // 256 PNG goes to disk for favicon use.
  fs.writeFileSync(OUT_PNG, pngs[pngs.length - 1]);
  console.log(`wrote ${OUT_PNG}`);
  // Pack all sizes into a multi-resolution ICO.
  const ico = await pngToIco(pngs);
  fs.writeFileSync(OUT_ICO, ico);
  console.log(`wrote ${OUT_ICO} (${SIZES.length} sizes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
