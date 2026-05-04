/**
 * tga.js - A minimal TGA (Targa) image loader for browsers and Node.js.
 *
 * This is a standalone copy for in-browser use, originally by @ivoviz and @ScottyFillups.
 *
 * Supports uncompressed and RLE-compressed 24/32-bit TGA files.
 *
 * Usage:
 *   import TGA from "./tga";
 *   const tga = new TGA(Uint8Array_of_file);
 *   const imageData = tga.getImageData();
 *   ctx.putImageData(imageData, 0, 0);
 */

function TGA(data) {
  if (!(this instanceof TGA)) return new TGA(data);
  if (data instanceof ArrayBuffer) data = new Uint8Array(data);
  this.width = 0;
  this.height = 0;
  this.pixels = null;
  this.hasAlpha = false;
  this.parse(data);
}

TGA.prototype.parse = function (data) {
  function getUint16(i) {
    return data[i] + (data[i + 1] << 8);
  }
  // Header
  const idLength = data[0];
  const imageType = data[2];
  const width = getUint16(12);
  const height = getUint16(14);
  const pixelSize = data[16];
  const flags = data[17];

  // Sanity-check header before allocating buffers — corrupt or non-TGA
  // files (typos, wrong format, 0-byte placeholders) shouldn't throw deep
  // in the decode loop. The icon resolver expects null-on-failure, not
  // exceptions. Width/height/pixelSize are uint16/uint8 so out-of-range
  // is impossible, but image dims can still be 0×0 or absurd.
  if (data.length < 18 || width === 0 || height === 0 || width > 8192 || height > 8192) {
    this.width = 0; this.height = 0; this.pixels = null; this.flags = 0;
    return;
  }

  this.width = width;
  this.height = height;
  this.hasAlpha = pixelSize === 32;
  this.flags = flags;

  let offset = 18 + idLength;
  let pixels;
  let npixels = width * height;

  // Only supporting true-color images (type 2 = uncompressed, 10 = RLE compressed)
  if ((imageType === 2 || imageType === 10) && (pixelSize === 24 || pixelSize === 32)) {
    if (imageType === 2) {
      // Uncompressed
      pixels = new Uint8Array(npixels * 4);
      for (let i = 0, p = 0; i < npixels; ++i, p += 4) {
        let b = data[offset++];
        let g = data[offset++];
        let r = data[offset++];
        let a = pixelSize === 32 ? data[offset++] : 255;
        pixels[p] = r;
        pixels[p + 1] = g;
        pixels[p + 2] = b;
        pixels[p + 3] = a;
      }
    } else {
      // RLE compressed
      pixels = new Uint8Array(npixels * 4);
      let i = 0, p = 0;
      while (i < npixels) {
        let c = data[offset++];
        let count = (c & 0x7F) + 1;
        if (c & 0x80) {
          // RLE chunk
          let b = data[offset++];
          let g = data[offset++];
          let r = data[offset++];
          let a = pixelSize === 32 ? data[offset++] : 255;
          for (let j = 0; j < count; ++j, ++i, p += 4) {
            pixels[p] = r;
            pixels[p + 1] = g;
            pixels[p + 2] = b;
            pixels[p + 3] = a;
          }
        } else {
          // Raw chunk
          for (let j = 0; j < count; ++j, ++i, p += 4) {
            let b = data[offset++];
            let g = data[offset++];
            let r = data[offset++];
            let a = pixelSize === 32 ? data[offset++] : 255;
            pixels[p] = r;
            pixels[p + 1] = g;
            pixels[p + 2] = b;
            pixels[p + 3] = a;
          }
        }
      }
    }
  } else {
    // Unsupported TGA type or pixel size — return empty rather than throw
    // so the icon resolver can fall through cleanly.
    this.width = 0; this.height = 0; this.pixels = null; this.flags = 0;
    return;
  }

  // Image origin (flip vertically if bottom-left)
  const originMask = 0x20;
  if (!(flags & originMask)) {
    // bottom-left: need to flip vertically
    let stride = width * 4;
    let tmp = new Uint8Array(stride);
    for (let y = 0; y < height / 2; ++y) {
      let top = y * stride;
      let bot = (height - y - 1) * stride;
      tmp.set(pixels.slice(top, top + stride));
      pixels.set(pixels.slice(bot, bot + stride), top);
      pixels.set(tmp, bot);
    }
  }

  this.pixels = pixels;
};

TGA.prototype.getImageData = function () {
  if (typeof ImageData !== "undefined") {
    return new ImageData(
      new Uint8ClampedArray(this.pixels.buffer, this.pixels.byteOffset, this.pixels.length),
      this.width,
      this.height
    );
  } else {
    // For Node.js/canvas
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.pixels.buffer, this.pixels.byteOffset, this.pixels.length)
    };
  }
};

export default TGA;