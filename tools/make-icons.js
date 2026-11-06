/* 生成扩展图标（无第三方依赖）
 * 运行: node tools/make-icons.js
 * 输出: extension/icons/icon{16,32,48,128}.png
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const rowLen = width * 4;
  const raw = Buffer.alloc((rowLen + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * rowLen, rowLen)
      .copy(raw, y * (rowLen + 1) + 1);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 图标绘制 ---------- */
const BG = [79, 140, 255, 255];    // #4f8cff
const FG = [255, 255, 255, 255];
const EDGE = [38, 90, 190, 255];

/* 5x7 的字母 S */
const GLYPH = [
  '01110',
  '10001',
  '10000',
  '01110',
  '00001',
  '10001',
  '01110'
];

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const radius = Math.max(2, Math.round(size * 0.22));

  function set(x, y, c) {
    const i = (y * size + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = c[3];
  }

  function inside(x, y, r) {
    const cx = Math.min(Math.max(x, r), size - 1 - r);
    const cy = Math.min(Math.max(y, r), size - 1 - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y, radius)) continue;
      // 边缘 1px 用深色描边
      if (!inside(x, y, Math.max(1, radius - 1))) {
        set(x, y, EDGE);
      } else {
        set(x, y, BG);
      }
    }
  }

  const gw = 5;
  const gh = 7;
  const scale = Math.max(1, Math.floor((size * 0.72) / gh));
  const ox = Math.floor((size - gw * scale) / 2);
  const oy = Math.floor((size - gh * scale) / 2);

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (GLYPH[gy][gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          set(ox + gx * scale + sx, oy + gy * scale + sy, FG);
        }
      }
    }
  }

  return px;
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[16, 32, 48, 128].forEach((size) => {
  const png = encodePng(size, size, drawIcon(size));
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
});
