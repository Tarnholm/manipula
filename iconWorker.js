// iconWorker.js — Node worker_threads worker that decodes a TGA file and writes the PNG to
// a cache path. Sharded across N workers from main.js so the CPU work parallelises across
// cores instead of hogging the main process event loop.

const { parentPort } = require("worker_threads");
const fs = require("fs");
const { tgaFileToPng } = require("./tgaDecode");

parentPort.on("message", ({ id, tgaPath, cachePath }) => {
  try {
    const png = tgaFileToPng(tgaPath);
    if (!png) { parentPort.postMessage({ id, ok: false }); return; }
    fs.writeFileSync(cachePath, png);
    parentPort.postMessage({ id, ok: true });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
});
