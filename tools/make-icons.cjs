// Рисует иконки приложения (PNG) без внешних зависимостей: node tools/make-icons.cjs
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [58, 91, 217], FG = [255, 255, 255];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
const CRC = crcTable();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Coverage of the white glyph at point (x, y) in 0..1 space; `pad` shrinks it toward the center (maskable safe zone).
function inGlyph(x, y, pad) {
  const s = 1 - pad * 2; x = (x - pad) / s; y = (y - pad) / s;
  // speech bubble: rounded rect
  const rx = 0.2, ry = 0.22, rw = 0.6, rh = 0.44, r = 0.12;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r), cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  const inRect = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  // tail triangle
  const ax = 0.3, ay = 0.6, bx = 0.46, by = 0.6, tx = 0.28, ty = 0.8;
  const sign = (px, py, qx, qy, ox, oy) => (px - ox) * (qy - oy) - (qx - ox) * (py - oy);
  const d1 = sign(x, y, ax, ay, bx, by), d2 = sign(x, y, bx, by, tx, ty), d3 = sign(x, y, tx, ty, ax, ay);
  const inTail = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  if (!inRect && !inTail) return 0;
  // three dots cut out in background color
  for (const dx of [0.36, 0.5, 0.64]) if ((x - dx) ** 2 + (y - 0.44) ** 2 <= 0.045 ** 2) return 0;
  return 1;
}

function png(size, maskable) {
  const SS = 4, raw = Buffer.alloc(size * (size * 4 + 1));
  const rad = maskable ? 0 : 0.22;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let fg = 0, bgA = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        // rounded-square background
        const cx = Math.min(Math.max(x, rad), 1 - rad), cy = Math.min(Math.max(y, rad), 1 - rad);
        const inBg = rad === 0 || (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
        if (!inBg) continue;
        bgA++;
        fg += inGlyph(x, y, maskable ? 0.12 : 0);
      }
      const n = SS * SS, a = bgA / n, f = bgA ? fg / bgA : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - f) + FG[i] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const out = path.join(__dirname, "..");
fs.writeFileSync(path.join(out, "icon-192.png"), png(192, false));
fs.writeFileSync(path.join(out, "icon-512.png"), png(512, false));
fs.writeFileSync(path.join(out, "icon-512-maskable.png"), png(512, true));
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), png(180, true));
console.log("icons written");
