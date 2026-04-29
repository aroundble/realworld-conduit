#!/usr/bin/env node
// Regenerate the PWA icon set (#149). Writes solid-fill PNGs to
// apps/web/public/icons/ at the sizes the manifest references.
// Solid #2c7a2c matches the --conduit-green brand token.
//
// Usage: node scripts/gen-pwa-icons.mjs
//
// The icons are placeholder — a proper brand asset (C monogram,
// rounded corners, padded for maskable safe-area) should replace
// these when design ships one. The placeholder does satisfy
// Chrome's installability contract (RGBA PNG at the declared
// sizes) so the install prompt appears in dev + staging.

import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

if (typeof crc32 !== "function") {
  throw new Error("need node 22.2+ for zlib.crc32");
}

/** Build a minimal RGBA PNG buffer at `size`×`size` filled with `color`. */
function solidPng(size, color) {
  const [r, g, b, a] = color;
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idatData = deflateSync(raw);
  const chunks = [];
  chunks.push(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, "ascii");
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
    return Buffer.concat([len, typeB, data, crcB]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(chunk("IHDR", ihdr));
  chunks.push(chunk("IDAT", idatData));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

const GREEN = [44, 122, 44, 255]; // #2c7a2c
const OUT = "apps/web/public/icons";

writeFileSync(`${OUT}/icon-192.png`, solidPng(192, GREEN));
writeFileSync(`${OUT}/icon-512.png`, solidPng(512, GREEN));
writeFileSync(`${OUT}/icon-512-maskable.png`, solidPng(512, GREEN));
writeFileSync(`${OUT}/apple-touch-icon.png`, solidPng(180, GREEN));

console.log(`icons written to ${OUT}`);
