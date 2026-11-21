'use strict';
/**
 * An .ico file from PNG pictures, as Windows has read them since Vista: a six-byte header, one sixteen-byte entry per
 * picture, then the PNGs themselves. main.js writes one per accent for the taskbar (windowIcon()), which takes its
 * icon from a file, not from the window.
 *
 *   ico([{ size: 32, png: Buffer }, ...]) -> Buffer
 */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let at = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

module.exports = { ico };
