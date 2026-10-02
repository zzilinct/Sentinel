/*
 * Sentinel's masks in real 3D (built into web/assets/js/mask3d.js by scripts/mask3d/build.js; edit this file).
 *
 * The models are the Blender masks themselves (scripts/blender/masks.py --glb), lit here in real time with a studio
 * environment, so they stay sharp at any size and can turn for real. Each element with data-mask3d gets one:
 *
 *   data-mask3d="onyx|scam|virus|malware"   which mask, in which finish (onyx: the black lacquer one)
 *   data-tint="yellow|orange|red"           a severity colour instead of the mask's own metal
 *   data-pose="lay"                         tipped back and turned, as the hero lies across the name
 *   data-look="620"                         turns to watch the pointer when it comes within about this many pixels
 *   data-eyes                               glowing eyes, brighter while it watches (the hero only)
 *
 * The <img> inside stays until the model is drawn (and stays for good without WebGL or with reduced motion: a
 * still render is the right answer there). window.SentinelMask3D.get(el) returns the mask's controls: tint(name),
 * swallow(newTint, ms) for the threat plates' black hole, and mix(a, b, t) for the colour reading.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, MeshPhysicalMaterial, Color, Group, DirectionalLight,
  HemisphereLight, Mesh, PlaneGeometry, MeshBasicMaterial, AdditiveBlending, CanvasTexture, SpriteMaterial, Sprite,
  SRGBColorSpace, AgXToneMapping, DoubleSide, Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const BASE = (document.currentScript && document.currentScript.src) ? new URL('../models/', document.currentScript.src).href : '/assets/models/';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Finishes, matching the Blender renders (masks.py LOOKS and TINTS).
const FINISH = {
  onyx: { color: '#0b0a09', metalness: 0.15, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, rim: '#ffb455', env: 1.25 },
  scam: { color: '#f2b64b', metalness: 1, roughness: 0.17, clearcoat: 0.4, clearcoatRoughness: 0.06, rim: '#ffa04a', env: 1 },
  virus: { color: '#ff5a10', metalness: 1, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.06, rim: '#ff7a2a', env: 1 },
  malware: { color: '#a1040c', metalness: 0.85, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, rim: '#ff2a20', env: 1 },
  yellow: { color: '#ffbf1f', metalness: 1, roughness: 0.18, clearcoat: 0.5, clearcoatRoughness: 0.06, rim: '#ffd060', env: 1 },
  orange: { color: '#ff5a0a', metalness: 1, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.06, rim: '#ff7a24', env: 1 },
  red: { color: '#a3030b', metalness: 0.85, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, rim: '#ff2a20', env: 1 }
};
const GEOMETRY = { onyx: 'scam', scam: 'scam', virus: 'virus', malware: 'malware' };

/* ------------------------------------------------------------- models */

const loader = new GLTFLoader();
const models = new Map();
const model = (name) => {
  if (!models.has(name)) models.set(name, loader.loadAsync(`${BASE}${name}.glb`).then((g) => g.scene));
  return models.get(name);
};

/* ----------------------------------------------- the black hole's shader */

// Added to the physical material: a swirl that tightens toward the middle, and a radius outside which the mask is
// gone, so it vanishes from the outside in (and grows back from the inside out), with a burning rim at the edge.
function swallowable(material, state) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRadius = state.radius;
    shader.uniforms.uSwirl = state.swirl;
    shader.uniforms.uRim = state.rim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwirl;\nvarying vec3 vMaskPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float r = length(transformed.xy);
        float a = uSwirl * 2.6 / (r + 0.22);
        float s = sin(a), c = cos(a);
        transformed.xy = mat2(c, s, -s, c) * transformed.xy * (1.0 - 0.55 * uSwirl * (1.0 - smoothstep(0.0, 1.3, r)));
        transformed.z *= 1.0 - 0.6 * uSwirl;
        vMaskPos = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRadius;\nuniform vec3 uRim;\nvarying vec3 vMaskPos;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float edge = uRadius - length(vMaskPos.xy);
        if (edge < 0.0) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRim * (1.0 - smoothstep(0.0, 0.09, edge)) * 4.0 * step(uRadius, 1.6);`);
  };
  material.customProgramCacheKey = () => 'sentinel-swallow';
}

/* -------------------------------------------------------------- a glow */

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,170,1)');
  grad.addColorStop(0.25, 'rgba(255,205,70,.65)');
  grad.addColorStop(0.6, 'rgba(255,170,30,.16)');
  grad.addColorStop(1, 'rgba(255,150,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* --------------------------------------------------------------- a mask */

const masks = new WeakMap();
let pointer = null;
addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
document.addEventListener('pointerleave', () => { pointer = null; });

const mounting = new WeakMap();
function mount(el) {
  if (!mounting.has(el)) mounting.set(el, build(el));
  return mounting.get(el);
}

async function build(el) {
  const kind = el.dataset.mask3d;
  const geom = GEOMETRY[kind] || 'scam';
  let renderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch { return null; }   // no WebGL: the still render stays
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'mask3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new PerspectiveCamera(20, 1, 0.1, 50);
  camera.position.set(0, 0, 7.6);

  const finishName = el.dataset.tint || kind;
  const f = FINISH[finishName] || FINISH.scam;
  const state = { radius: { value: 9 }, swirl: { value: 0 }, rim: { value: new Color(f.rim) } };
  const material = new MeshPhysicalMaterial({
    color: new Color(f.color), metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness, envMapIntensity: f.env
  });
  swallowable(material, state);

  scene.add(new HemisphereLight(0xfff2dd, 0x1a1208, 0.35));
  const key = new DirectionalLight(0xfff1dc, 2.2);
  key.position.set(-3, 3.2, 4);
  const rimL = new DirectionalLight(new Color(f.rim), 3.2);
  rimL.position.set(-4, 1, -3);
  const rimR = new DirectionalLight(new Color(f.rim), 2.6);
  rimR.position.set(4, 1.5, -2.5);
  scene.add(key, rimL, rimR);

  // pivot: where the mask looks; holder: its resting pose.
  const pivot = new Group();
  const holder = new Group();
  pivot.add(holder);
  scene.add(pivot);
  const lay = el.dataset.pose === 'lay';
  // Blender's lay pose (x -24, y 28, z 16 degrees), turned a little more toward the viewer so the face reads.
  const rest = lay ? { x: -0.38, y: 0.12, z: -0.42 } : { x: 0, y: el.classList.contains('plate__art') ? 0 : -0.18, z: 0 };
  // Blender's XYZ turn (masks.py --pose lay), carried into glTF's Y-up axes: the same order becomes YZX.
  holder.rotation.order = 'YZX';
  holder.rotation.set(rest.x, rest.y, rest.z);

  let eyes = null;
  try {
    const src = await model(geom);
    const m = src.clone(true);
    m.traverse((o) => { if (o.isMesh) { o.material = material; } });
    holder.add(m);
    if (el.hasAttribute('data-eyes')) {
      // Light inside the mask, seen only through its eyes; and a glow over each eye that brightens as it watches.
      const glowMat = new MeshBasicMaterial({ color: 0xffc83a, side: DoubleSide, toneMapped: false });
      const inner = new Mesh(new PlaneGeometry(1.25, 0.34), glowMat);
      inner.position.set(0, 0.2, 0.18);
      holder.add(inner);
      const tex = glowTexture();
      const halos = [-0.36, 0.36].map((x) => {
        const s = new Sprite(new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false }));
        s.position.set(x, 0.2, 0.62);
        s.scale.set(0.62, 0.42, 1);
        holder.add(s);
        return s;
      });
      eyes = { glowMat, halos, level: 0.35 };
    }
  } catch {
    renderer.dispose();
    return null;
  }

  el.appendChild(canvas);
  el.classList.add('mask3d');

  /* -------- sizing, visibility */

  let w = 0;
  let h = 0;
  const resize = () => {
    const r = el.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole mask in frame whatever the box's shape.
    camera.fov = w / h < 0.72 ? 20 * (0.72 / (w / h)) : 20;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  let visible = true;
  let dirty = true;
  new ResizeObserver(resize).observe(el);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); }, { rootMargin: '80px' }).observe(el);
  resize();

  /* -------- motion: springs toward where it should look */

  const reach = Number(el.dataset.look) || 0;
  let spinAt = 0;
  if (!reach && !reduced && el.classList.contains('plate__art')) {
    el.addEventListener('pointerenter', () => { if (!spinAt && !anim) { spinAt = performance.now(); kick(); } });
  }
  const look = { x: 0, y: 0, vx: 0, vy: 0, w: 0, vw: 0 };
  let tx = 0;
  let ty = 0;
  let tw = 0;
  let last = performance.now();
  let raf = 0;
  const t0 = performance.now();
  let anim = null;   // a running swallow or colour change
  const colorFrom = new Color();
  const colorTo = new Color();

  const target = () => {
    tx = 0; ty = 0; tw = 0;
    if (!reach || !pointer || reduced) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.42;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const d = Math.hypot(dx, dy);
    // Watching only when the pointer is near: full within reach, letting go by twice that.
    const near = 1 - Math.min(1, Math.max(0, (d - reach) / reach));
    tw = near * near * (3 - 2 * near);
    tx = Math.max(-1, Math.min(1, dx / reach)) * tw;
    ty = Math.max(-1, Math.min(1, dy / reach)) * tw;
  };

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    target();
    // A spring: quick to turn, settling without a wobble.
    const k = 70;
    const c = 15;
    look.vx += ((tx - look.x) * k - look.vx * c) * dt; look.x += look.vx * dt;
    look.vy += ((ty - look.y) * k - look.vy * c) * dt; look.y += look.vy * dt;
    look.vw += ((tw - look.w) * k * 0.6 - look.vw * c) * dt; look.w += look.vw * dt;
    const t = (now - t0) / 1000;
    // Watching: the mask lifts out of its resting pose to face the pointer, then turns with it in three dimensions.
    const face = look.w * 0.7;
    holder.rotation.set(rest.x * (1 - face), rest.y * (1 - face), rest.z * (1 - face));
    const breathe = reduced ? 0 : Math.sin(t * 1.1) * 0.035 * (1 - look.w);
    // Masks that do not watch sway slowly on their own, like a piece turning on a display stand; a plate's mask
    // spins once all the way round when the pointer comes to it.
    const sway = !reach && !reduced ? { y: Math.sin(t * 0.42) * 0.34, x: Math.sin(t * 0.31) * 0.06 } : { y: 0, x: 0 };
    let spin = 0;
    if (spinAt) {
      const u = (now - spinAt) / 1800;
      if (u >= 1) spinAt = 0; else spin = (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2) * Math.PI * 2;
    }
    pivot.rotation.set(look.y * 0.5 + breathe * 0.4 + sway.x, look.x * 0.75 + sway.y + spin + (reduced ? 0 : Math.sin(t * 0.55) * 0.05 * (1 - look.w)), -look.x * 0.06);
    pivot.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.05;
    if (eyes) {
      const want = 0.35 + 0.65 * look.w;
      eyes.level += (want - eyes.level) * Math.min(1, dt * 6);
      const flicker = 0.92 + 0.08 * Math.sin(t * 13) * Math.sin(t * 7.3);
      eyes.glowMat.color.setRGB(1.6 * eyes.level * flicker, 1.15 * eyes.level * flicker, 0.25 * eyes.level);
      for (const s of eyes.halos) s.material.opacity = Math.max(0, (eyes.level - 0.3) * 1.35) * flicker;
    }
    if (anim && anim(now) === false) anim = null;
    renderer.render(scene, camera);
    dirty = false;
    const moving = Math.abs(tx - look.x) + Math.abs(ty - look.y) + Math.abs(tw - look.w) + Math.abs(look.vx) + Math.abs(look.vy) > 0.0005;
    // Breathing and glowing eyes keep a visible mask alive; otherwise it rests until something changes.
    if (visible && (moving || anim || eyes || !reduced)) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  addEventListener('pointermove', kick, { passive: true });
  kick();
  // Shown once the first frame is down: the still render steps aside.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('mask3d--ready')));

  /* -------- controls */

  const setFinish = (name) => {
    const fin = FINISH[name] || FINISH.scam;
    material.color.set(fin.color);
    material.metalness = fin.metalness;
    material.roughness = fin.roughness;
    material.clearcoat = fin.clearcoat;
    state.rim.value.set(fin.rim);
    rimL.color.set(fin.rim);
    rimR.color.set(fin.rim);
  };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const api = {
    el,
    // Straight to a finish (no transition).
    tint(name) { setFinish(name); kick(); },
    // A smooth change of colour, for the colour reading and the plates' quieter steps.
    blend(name, ms = 900) {
      const fin = FINISH[name] || FINISH.scam;
      colorFrom.copy(material.color);
      colorTo.set(fin.color);
      const start = performance.now();
      anim = (now) => {
        const u = Math.min(1, (now - start) / ms);
        material.color.copy(colorFrom).lerp(colorTo, ease(u));
        if (u >= 1) { setFinish(name); return false; }
        return true;
      };
      kick();
    },
    // The black hole: the mask is pulled in and vanishes from the outside in (out, ms), then the new one grows from
    // the inside out (in). Returns when the new mask is whole.
    swallow(name, { out = 1100, gap = 250, grow = 1100 } = {}) {
      return new Promise((done) => {
        const start = performance.now();
        const next = FINISH[name] || FINISH.scam;
        let swapped = false;
        anim = (now) => {
          const e = now - start;
          if (e < out) {
            const u = ease(e / out);
            state.radius.value = 1.5 * (1 - u);
            state.swirl.value = u;
          } else if (e < out + gap) {
            state.radius.value = 0;
            if (!swapped) { setFinish(name); state.rim.value.set(next.rim); swapped = true; }
          } else if (e < out + gap + grow) {
            const u = ease((e - out - gap) / grow);
            state.radius.value = 1.5 * u + 0.001;
            state.swirl.value = 1 - u;
          } else {
            state.radius.value = 9;
            state.swirl.value = 0;
            done();
            return false;
          }
          return true;
        };
        kick();
      });
    }
  };
  masks.set(el, api);
  return api;
}

/* ------------------------------------------------------- start them all */

function start() {
  if (!('IntersectionObserver' in window) || !('ResizeObserver' in window)) return;
  const all = [...document.querySelectorAll('[data-mask3d]')];
  // Each is built as it nears the screen, so a page with many masks does not start them all at once.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      mount(e.target).then((api) => { if (api) e.target.dispatchEvent(new CustomEvent('mask3d:ready', { detail: api })); });
    }
  }, { rootMargin: '300px' });
  all.forEach((el) => io.observe(el));
}

window.SentinelMask3D = { mount, get: (el) => masks.get(el) || null, scan: start, FINISH: Object.keys(FINISH) };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
