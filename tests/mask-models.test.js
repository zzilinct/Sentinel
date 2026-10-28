'use strict';
// The site's 3D masks (web/assets/models/*.glb, made by scripts/blender/masks.py --glb): read as files, without
// Blender, so every push checks what the browser will download. The full geometry and picture check is the masks job
// in .github/workflows/test.yml (scripts/blender/mask_qa.py).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'web', 'assets', 'models');
const MAX_BYTES = 560 * 1024;   // each model, maps included
const MAX_TRIS = 24000;
const MAX_MAP = 1024;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'glTF', `${file}: a binary glTF`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.toString('ascii', 16, 20), 'JSON');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  return { buf, json, bin: buf.subarray(binStart) };
}

// Width and height from a WebP's header (lossy VP8, lossless VP8L or extended VP8X).
function webpSize(b) {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  throw new Error(`unknown WebP chunk ${kind}`);
}

for (const name of ['scam', 'virus', 'malware']) {
  test(`${name}.glb: a low model with UVs, a baked normal map and occlusion map, within budget`, () => {
    const file = path.join(DIR, `${name}.glb`);
    const { buf, json, bin } = readGlb(file);
    assert.ok(buf.length <= MAX_BYTES, `${name}.glb is ${buf.length} bytes, over ${MAX_BYTES}`);

    const prims = json.meshes.flatMap((m) => m.primitives);
    assert.ok(prims.length >= 1);
    let tris = 0;
    for (const p of prims) {
      assert.ok('POSITION' in p.attributes && 'NORMAL' in p.attributes, 'positions and normals');
      assert.ok('TEXCOORD_0' in p.attributes, 'a UV map, for the baked maps');
      tris += json.accessors[p.indices].count / 3;
      const mat = json.materials[p.material];
      assert.ok(mat && mat.normalTexture, 'a normal map');
      assert.ok(mat.occlusionTexture, 'an occlusion map');
    }
    assert.ok(tris <= MAX_TRIS, `${tris} triangles, over ${MAX_TRIS}`);

    // The maps are WebP, square, a power of two and no larger than the budget.
    assert.ok(json.images.length >= 2);
    for (const img of json.images) {
      assert.equal(img.mimeType, 'image/webp');
      const view = json.bufferViews[img.bufferView];
      const [w, h] = webpSize(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
      assert.equal(w, h, `${img.name} is square`);
      assert.ok(w <= MAX_MAP && (w & (w - 1)) === 0, `${img.name} is ${w}x${h}`);
    }
    // The browser's glTF loader reads both the WebP maps and the compact (quantized) geometry.
    const used = json.extensionsUsed || [];
    assert.ok(used.includes('KHR_mesh_quantization'), 'quantized with gltf-transform, as the build notes say');
  });
}

test('mask3d.src.js puts the baked maps under the site\'s own finish', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mask3d', 'mask3d.src.js'), 'utf8');
  assert.match(src, /material\.normalMap = baked\.normalMap/);
  assert.match(src, /material\.clearcoatNormalMap = baked\.normalMap/);
  assert.match(src, /material\.aoMap = baked\.aoMap/);
});
