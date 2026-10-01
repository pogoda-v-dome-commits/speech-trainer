// Рисует иконки приложения (PNG) без внешних зависимостей.
//   node tools/make-icons.cjs            — иконки выбранного варианта в корень проекта
//   node tools/make-icons.cjs preview DIR — превью всех вариантов в DIR
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const VARIANT = "mic";

// ---------- PNG ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encode(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- Геометрия (координаты 0..1, SDF: <0 — внутри) ----------
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCapsuleV = (x, y, cx, y1, y2, r) => Math.hypot(x - cx, y - clamp(y, y1, y2)) - r;
const sdRing = (x, y, cx, cy, R, w) => Math.abs(Math.hypot(x - cx, y - cy) - R) - w / 2;
const inside = (d) => d <= 0;

// Каждый вариант: bg(x,y) → цвет фона, glyph(x,y) → [цвет, непрозрачность] или null
const VARIANTS = {
  // Микрофон со звуковыми волнами на градиенте индиго → фиолетовый
  mic: {
    bg: (x, y) => mix([79, 70, 229], [168, 85, 247], clamp((x + y) / 2, 0, 1)),
    glyph(x, y) {
      const W = [255, 255, 255];
      const cx = 0.5;
      if (inside(sdCapsuleV(x, y, cx, 0.33, 0.47, 0.095))) return [W, 1];
      // дужка держателя — нижняя половина кольца
      if (y >= 0.47 && inside(sdRing(x, y, cx, 0.47, 0.155, 0.04))) return [W, 1];
      if (inside(sdRoundRect(x, y, cx, 0.69, 0.02, 0.06, 0.005))) return [W, 1];
      if (inside(sdRoundRect(x, y, cx, 0.75, 0.1, 0.02, 0.02))) return [W, 1];
      // звуковые дуги по бокам
      const a = Math.abs(Math.atan2(y - 0.44, Math.abs(x - cx)));
      if (a < 0.6) {
        if (inside(sdRing(x, y, cx, 0.44, 0.255, 0.035))) return [W, 0.85];
        if (inside(sdRing(x, y, cx, 0.44, 0.335, 0.035))) return [W, 0.5];
      }
      return null;
    },
  },
  // Облачко речи со звуковой волной на тёплом градиенте
  bubble: {
    bg: (x, y) => mix([255, 122, 89], [236, 72, 153], clamp((x + y) / 2, 0, 1)),
    glyph(x, y) {
      const W = [255, 255, 255];
      const inBubble = inside(sdRoundRect(x, y, 0.5, 0.45, 0.31, 0.22, 0.13));
      const s = (px, py, qx, qy, ox, oy) => (px - ox) * (qy - oy) - (qx - ox) * (py - oy);
      const d1 = s(x, y, 0.3, 0.6, 0.45, 0.62), d2 = s(x, y, 0.45, 0.62, 0.27, 0.8), d3 = s(x, y, 0.27, 0.8, 0.3, 0.6);
      const inTail = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      if (!inBubble && !inTail) return null;
      const H = [0.05, 0.1, 0.15, 0.1, 0.05];
      for (let i = 0; i < 5; i++) {
        if (inside(sdRoundRect(x, y, 0.34 + i * 0.08, 0.45, 0.022, H[i], 0.022))) return [mix([255, 122, 89], [236, 72, 153], 0.4 + i * 0.05), 1];
      }
      return [W, 1];
    },
  },
  // Минимализм: тёмный фон и градиентная звуковая волна
  wave: {
    bg: (x, y) => mix([22, 27, 51], [12, 15, 30], y),
    glyph(x, y) {
      const H = [0.06, 0.13, 0.22, 0.3, 0.22, 0.13, 0.06];
      for (let i = 0; i < 7; i++) {
        const cx = 0.26 + i * 0.08;
        if (inside(sdRoundRect(x, y, cx, 0.5, 0.025, H[i], 0.025))) return [mix([45, 212, 191], [168, 85, 247], i / 6), 1];
      }
      return null;
    },
  },
};

function render(variant, size, maskable) {
  const V = VARIANTS[variant], SS = 4, out = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0.1 : 0; // безопасная зона для «маскируемых» иконок Android
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      if (!maskable && !inside(sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22))) continue;
      let c = V.bg(x, y);
      const gx = (x - pad) / (1 - 2 * pad), gy = (y - pad) / (1 - 2 * pad);
      const gl = V.glyph(gx, gy);
      if (gl) c = mix(c, gl[0], gl[1]);
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const o = (py * size + px) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
  return encode(size, out);
}

const [, , cmd, dir] = process.argv;
if (cmd === "preview") {
  for (const v of Object.keys(VARIANTS)) fs.writeFileSync(path.join(dir, `preview-${v}.png`), render(v, 256, false));
  console.log("previews written to", dir);
} else {
  const out = path.join(__dirname, "..");
  fs.writeFileSync(path.join(out, "icon-192.png"), render(VARIANT, 192, false));
  fs.writeFileSync(path.join(out, "icon-512.png"), render(VARIANT, 512, false));
  fs.writeFileSync(path.join(out, "icon-512-maskable.png"), render(VARIANT, 512, true));
  fs.writeFileSync(path.join(out, "apple-touch-icon.png"), render(VARIANT, 180, true));
  console.log("icons written:", VARIANT);
}
