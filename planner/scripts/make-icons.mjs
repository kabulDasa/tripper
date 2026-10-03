// Rasterises the app icon (same design as public/icon.svg) to PNG without dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

// Shape tests in 512-unit icon space. Returns RGBA or null (transparent).
function shade(x, y, rounded) {
  const inRoundRect = (() => {
    if (!rounded) return true;
    const r = 112;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    return Math.hypot(x - cx, y - cy) <= r;
  })();
  if (!inRoundRect) return null;
  const d = Math.hypot(x - 256, y - 256);
  // arrow: stem x∈[200,252] y∈[250,400]; bar y∈[224,276] x∈[200,296]; head triangle (290,186)-(382,250)-(290,314)
  const stem = x >= 200 && x <= 252 && y >= 224 && y <= 400;
  const bar = y >= 224 && y <= 276 && x >= 200 && x <= 296;
  const head = x >= 290 && x <= 382 && Math.abs(y - 250) <= ((382 - x) / 92) * 64;
  if (d <= 182 && (stem || bar || head)) return [255, 255, 255, 255];
  if (d <= 182) return [0, 0, 0, 255];
  if (d <= 210) return [255, 176, 0, 255];
  return [17, 19, 24, 255];
}

function png(size, rounded) {
  const ss = 4; // supersampling
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade(((px + (sx + 0.5) / ss) / size) * 512, ((py + (sy + 0.5) / ss) / size) * 512, rounded);
          if (c) for (let k = 0; k < 4; k++) acc[k] += c[k];
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let k = 0; k < 4; k++) raw[o + k] = Math.round(acc[k] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', png(192, false));
writeFileSync('public/icon-512.png', png(512, false));
writeFileSync('public/apple-touch-icon.png', png(180, false));
console.log('icons written');
