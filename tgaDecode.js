// tgaDecode.js — Node-side TGA → PNG converter used by the rticon:// custom protocol.
// Pure JS, no native deps. The renderer never sees TGA bytes; it just gets PNG over the
// custom protocol, so React components render via plain <img src="rticon://..."> with no
// JS-side decode and no main-thread blocking.

const zlib = require("zlib");

// ── TGA decoder (kept in sync with src/tga.js — same parser, no DOM use) ──
function decodeTga(data) {
  if (data instanceof Buffer) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  function getUint16(i) { return data[i] + (data[i + 1] << 8); }
  const idLength = data[0];
  const imageType = data[2];
  const width = getUint16(12);
  const height = getUint16(14);
  const pixelSize = data[16];
  const flags = data[17];
  if (!width || !height || width > 8192 || height > 8192) throw new Error("invalid tga dims");
  if (pixelSize !== 24 && pixelSize !== 32) throw new Error("unsupported pixel size " + pixelSize);
  const isRle = imageType === 10;
  const isUncompressed = imageType === 2;
  if (!isRle && !isUncompressed) throw new Error("unsupported image type " + imageType);
  const bytesPerPixel = pixelSize / 8;
  const pixels = new Uint8Array(width * height * 4);
  let p = 18 + idLength;
  let i = 0;
  const total = width * height;
  if (isUncompressed) {
    for (let n = 0; n < total; n++) {
      const b = data[p], g = data[p + 1], r = data[p + 2];
      const a = pixelSize === 32 ? data[p + 3] : 255;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
      p += bytesPerPixel; i += 4;
    }
  } else {
    let n = 0;
    while (n < total) {
      const header = data[p++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const b = data[p], g = data[p + 1], r = data[p + 2];
        const a = pixelSize === 32 ? data[p + 3] : 255;
        p += bytesPerPixel;
        for (let k = 0; k < count; k++) {
          pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
          i += 4;
        }
      } else {
        for (let k = 0; k < count; k++) {
          const b = data[p], g = data[p + 1], r = data[p + 2];
          const a = pixelSize === 32 ? data[p + 3] : 255;
          pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
          p += bytesPerPixel; i += 4;
        }
      }
      n += count;
    }
  }
  // TGA's default origin is bottom-left; bit 5 of flags = top-down.
  if (!(flags & 0x20)) {
    const rowSize = width * 4;
    const flipped = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y++) {
      flipped.set(pixels.subarray(y * rowSize, (y + 1) * rowSize), (height - 1 - y) * rowSize);
    }
    return { width, height, pixels: flipped };
  }
  return { width, height, pixels };
}

// ── Minimal PNG encoder (filter type 0, color type 6 RGBA, no interlace) ──
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "binary");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function rgbaToPng(rgba, width, height) {
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter byte = none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(filtered, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(filtered, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression deflate
  ihdr[11] = 0;  // filter adaptive
  ihdr[12] = 0;  // interlace none
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Decode a TGA file path → PNG Buffer. Returns null on error.
function tgaFileToPng(tgaPath) {
  try {
    const tga = decodeTga(require("fs").readFileSync(tgaPath));
    return rgbaToPng(tga.pixels, tga.width, tga.height);
  } catch { return null; }
}

module.exports = { decodeTga, rgbaToPng, tgaFileToPng };
