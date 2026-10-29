'use strict';
// The live masks (scripts/mask3d/mask3d.src.js) are never cut off by their canvas: every model, in every place the
// site shows one, is turned through all the motion it can make (watching the pointer, breathing, swaying) with the
// camera of scripts/mask3d/pose.js, and every vertex must stay inside the view. Also the studio panoramas they reflect.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CAMERA, POSES, halfView, drift } = require('../scripts/mask3d/pose.js');

const MODELS = path.join(__dirname, '..', 'web', 'assets', 'models');

// The model's vertices as the browser places them (KHR_mesh_quantization int16, then the node's scale and offset).
function vertices(name) {
  const buf = fs.readFileSync(path.join(MODELS, `${name}.glb`));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + len));
  const bin = buf.subarray(20 + len + 8);
  const node = json.nodes.find((n) => n.mesh === 0);
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  assert.equal(acc.componentType, 5122, 'positions quantized to int16');
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride || 6;
  const out = [];
  for (let i = 0; i < acc.count; i += 2) {
    const o = (view.byteOffset || 0) + (acc.byteOffset || 0) + i * stride;
    out.push([0, 1, 2].map((k) => Math.max(-1, bin.readInt16LE(o + 2 * k) / 32767) * node.scale[k] + node.translation[k]));
  }
  return out;
}

const rot = (axis, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const apply = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

// The farthest any vertex gets from the middle of the view, as a share of the way to its edge (1 = on the edge).
function reach(verts, { pose, aspect, watches, sways }) {
  const { rest, frame, zoom } = POSES[pose];
  const half = halfView(aspect, zoom);
  const looks = [];
  for (const w of watches ? [0, 0.5, 1] : [0]) for (const x of [-w, 0, w]) for (const y of [-w, 0, w]) looks.push({ x, y, w });
  let worst = 0;
  for (const look of looks) {
    const face = look.w * 0.5;
    // three.js Euler orders: holder YZX, pivot XYZ.
    const H = mul(mul(rot('y', rest.y * (1 - face)), rot('z', rest.z * (1 - face))), rot('x', rest.x * (1 - face)));
    for (let t = 0; t < 41; t += sways ? 0.5 : 2.5) {
      const d = drift(t, look, sways, false);
      const M = mul(mul(mul(rot('x', d.x), rot('y', d.y)), rot('z', d.z)), H);
      for (const v of verts) {
        const p = apply(M, v.map((c) => c * frame.s));
        const depth = CAMERA.z - p[2];
        worst = Math.max(worst, Math.abs((p[0] + frame.x) / depth / half / aspect), Math.abs((p[1] + frame.y + d.lift) / depth / half));
      }
    }
  }
  return worst;
}

// Each place a live mask is shown (web/*.html data-mask3d), with its canvas's shape (the picture's, or the plate's).
const PLACES = [
  ['hero and lock art (onyx, lying)', 'scam', { pose: 'lay', aspect: 788 / 896, watches: true }],
  ['page heads (onyx, standing)', 'scam', { pose: 'stand', aspect: 788 / 896, watches: true }],
  ['manifesto (watching)', 'scam', { pose: 'stand', aspect: 0.7, watches: true }],
  ['call to action and pricing (swaying)', 'scam', { pose: 'stand', aspect: 0.7, sways: true }],
  ['plate: scam', 'scam', { pose: 'plate', aspect: 1, sways: true }],
  ['plate: virus', 'virus', { pose: 'plate', aspect: 1, sways: true }],
  ['plate: malware', 'malware', { pose: 'plate', aspect: 1, sways: true }]
];
const cache = {};
for (const [place, model, how] of PLACES) {
  test(`${place}: the ${model} mask stays inside its canvas however it turns`, () => {
    const r = reach(cache[model] || (cache[model] = vertices(model)), how);
    assert.ok(r < 0.98, `reaches ${(r * 100).toFixed(1)}% of the way to the canvas edge`);
  });
}

// The studios (scripts/blender/masks.py --env): Radiance HDR panoramas, 2:1, small enough to fetch with the page.
for (const name of ['scam', 'onyx']) {
  test(`studio-${name}.hdr: a small 2:1 Radiance panorama`, () => {
    const buf = fs.readFileSync(path.join(MODELS, `studio-${name}.hdr`));
    const head = buf.toString('latin1', 0, 200);
    assert.match(head, /^#\?RADIANCE/);
    assert.match(head, /FORMAT=32-bit_rle_rgbe/);
    const [, h, w] = head.match(/-Y (\d+) \+X (\d+)/).map(Number);
    assert.equal(w, h * 2);
    assert.ok(buf.length <= 32 * 1024, `${buf.length} bytes`);
  });
}
