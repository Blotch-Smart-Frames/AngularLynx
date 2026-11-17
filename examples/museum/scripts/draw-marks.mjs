// Draws Vitrine's app icon and splash mark (src/assets/launch): a glazed
// window of seeded-white panes with one cobalt and one amber pane, between
// matte black bars. Run from the example: node scripts/draw-marks.mjs src/assets/launch
// It writes the same pixels each run; the PNGs in the repo also carry a
// description of how they were made (impeccable embed-prompt), which a rerun
// drops.
// cspell:words IHDR IDAT IEND -- PNG's chunk names
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const out = process.argv[2];
if (!out) throw new Error('usage: node draw-marks.mjs <out-dir>');

const BAR = [20, 20, 20];
const SEED = [222, 220, 212];
const CLEAR = [236, 235, 230];
const COBALT = [29, 63, 166];
const AMBER = [200, 138, 28];

// A small deterministic PRNG, so the seeds land in the same places each run.
let state = 0x2f6b1d;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 100000) / 100000;
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/**
 * `opaque` writes RGB without an alpha channel, which an app icon needs.
 */
const png = (w, h, rgba, opaque) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  const bpp = opaque ? 3 : 4;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = 0;
    for (let x = 0; x < w; x++)
      for (let k = 0; k < bpp; k++)
        raw[y * (w * bpp + 1) + 1 + x * bpp + k] = rgba[(y * w + x) * 4 + k];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * Draws the window into a w×h canvas. `frame` is the window's box, `bar`
 * the glazing bar's thickness; `ground` fills outside the window (null for
 * transparent).
 */
const draw = (w, h, frame, bar, ground) => {
  const px = Buffer.alloc(w * h * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ground) set(x, y, ground);
      else set(x, y, [0, 0, 0], 0);

  const { x: fx, y: fy, size } = frame;
  // Columns: a wide one and a narrow mullion column; rows: tall over short.
  const cols = [0, 0.7, 1];
  const rows = [0, 0.64, 1];
  const panes = [
    [0, 0, SEED],
    [1, 0, COBALT],
    [0, 1, CLEAR],
    [1, 1, AMBER],
  ];
  // The bars: the whole window black first, panes inset by half a bar.
  for (let y = fy; y < fy + size; y++)
    for (let x = fx; x < fx + size; x++) set(x, y, BAR);
  for (const [c, r, color] of panes) {
    const x0 = Math.round(
      fx + bar + cols[c] * (size - 2 * bar) + (c ? bar / 2 : 0),
    );
    const x1 = Math.round(
      fx + bar + cols[c + 1] * (size - 2 * bar) - (c ? 0 : bar / 2),
    );
    const y0 = Math.round(
      fy + bar + rows[r] * (size - 2 * bar) + (r ? bar / 2 : 0),
    );
    const y1 = Math.round(
      fy + bar + rows[r + 1] * (size - 2 * bar) - (r ? 0 : bar / 2),
    );
    // Hand-rolled glass: a slow wave of light across the pane, grain, and
    // a few seeds (bubbles) a shade lighter.
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const wave = Math.sin((x - x0) / 23 + (y - y0) / 31) * 3;
        const grain = (rand() - 0.5) * 5;
        set(
          x,
          y,
          color.map((v) =>
            Math.max(0, Math.min(255, Math.round(v + wave + grain))),
          ),
        );
      }
    const seeds = Math.round(((x1 - x0) * (y1 - y0)) / 9000);
    for (let s = 0; s < seeds; s++) {
      const cx = x0 + rand() * (x1 - x0);
      const cy = y0 + rand() * (y1 - y0);
      const rad = 1.5 + rand() * (size / 260);
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
        for (let x = Math.floor(cx - rad * 1.4); x <= cx + rad * 1.4; x++) {
          if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
          const d = ((x - cx) / 1.4) ** 2 + (y - cy) ** 2;
          if (d > rad * rad) continue;
          const i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, px[i + k] + 10);
        }
    }
  }
  return png(w, h, px, ground !== null);
};

// The icon: opaque, the window inset on the bar-black ground, as iOS masks
// its corners and Android its shape.
writeFileSync(
  join(out, 'icon.png'),
  draw(1024, 1024, { x: 212, y: 212, size: 600 }, 30, BAR),
);
// The splash mark: transparent around the window, shown at 120pt on the
// splash's bar-black color (so the frame reads as the bars between panes).
writeFileSync(
  join(out, 'splash.png'),
  draw(480, 480, { x: 0, y: 0, size: 480 }, 22, null),
);
console.log('wrote icon.png and splash.png to', out);
