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
// How often a mask that is only drifting (breathing, swaying, its eyes flickering) is redrawn: slow motion needs few
// frames, and on a phone fewer still (the drift is the same, the phone stays cool).
const IDLE_MS = matchMedia('(pointer: coarse)').matches ? 66 : 33;

// Finishes, matching the Blender renders (masks.py LOOKS and TINTS).
const FINISH = {
  // The hero: a darker silver than the studio light first gave it (env 1.25 read as bright chrome and hid its eyes).
  onyx: { color: '#0b0a09', metalness: 0.15, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, rim: '#ffb455', env: 0.72 },
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

// Added to the physical material. Consumed: a horizon (uEat) grows from the middle and everything inside it is gone,
// while the metal just outside is dragged round and in toward it. Reborn: a radius (uRadius) grows from the middle
// with a swirl that unwinds, so the new mask comes out of the hole. Both edges burn in the hole's colour.
function swallowable(material, state) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRadius = state.radius;
    shader.uniforms.uSwirl = state.swirl;
    shader.uniforms.uRim = state.rim;
    shader.uniforms.uEat = state.eat;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwirl;\nuniform float uEat;\nvarying vec3 vMaskPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float r = length(transformed.xy);
        float a = uSwirl * 2.6 / (r + 0.22);
        float s = sin(a), c = cos(a);
        transformed.xy = mat2(c, s, -s, c) * transformed.xy * (1.0 - 0.55 * uSwirl * (1.0 - smoothstep(0.0, 1.3, r)));
        transformed.z *= 1.0 - 0.6 * uSwirl;
        // Tidal pull: within reach of the horizon the metal is dragged round and in, harder the closer it is.
        float rr = length(transformed.xy);
        // The pull eases in as the hole grows, so nothing is bent before it is there to bend it.
        float pull = uEat > 0.0 ? (1.0 - smoothstep(uEat, uEat + 0.8, rr)) * smoothstep(0.0, 0.45, uEat) : 0.0;
        float tw = pull * pull * 2.2;
        float ts = sin(tw), tc = cos(tw);
        transformed.xy = mat2(tc, ts, -ts, tc) * transformed.xy * (1.0 - 0.3 * pull);
        transformed.z -= pull * 0.35;
        vMaskPos = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRadius;\nuniform float uEat;\nuniform vec3 uRim;\nvarying vec3 vMaskPos;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float edge = uRadius - length(vMaskPos.xy);
        if (edge < 0.0) discard;
        float eaten = length(vMaskPos.xy) - uEat;
        if (uEat > 0.0 && eaten < 0.0) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRim * (1.0 - smoothstep(0.0, 0.09, edge)) * 4.0 * step(uRadius, 1.6);
        if (uEat > 0.0) totalEmissiveRadiance += uRim * (1.0 - smoothstep(0.0, 0.14, eaten)) * 5.0;`);
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

/* ------------------------------------------------------- one renderer for all */

/*
 * Every mask on the page is drawn by one WebGL renderer, into its own plain canvas: one drawing context, one studio
 * light, each shader built once. A context per mask cost each of them all of that again (seven on the home page),
 * and a phone that ran out of contexts dropped the oldest mid-scroll.
 */
let shared;
function renderer() {
  if (shared !== undefined) return shared;
  try {
    const r = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    r.setPixelRatio(1);   // sizes below are in device pixels already
    r.toneMapping = AgXToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    const pmrem = new PMREMGenerator(r);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    shared = { r, env, w: 0, h: 0, lost: false };
    // A phone short of memory can take the context away: every mask goes back to its still picture.
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      shared.lost = true;
      for (const m of all) m.el.classList.remove('mask3d--ready');
    });
  } catch { shared = null; }
  return shared;
}
// The drawing surface only grows (to the largest mask), so changing between masks never reallocates it.
function fit(w, h) {
  if (w <= shared.w && h <= shared.h) return;
  shared.w = Math.max(shared.w, w);
  shared.h = Math.max(shared.h, h);
  shared.r.setSize(shared.w, shared.h, false);
}

/* -------------------------------------------- one clock, paused while scrolling */

const all = new Set();
let raf = 0;
// While the page scrolls, the idle drifting (breathing, swaying) waits: frames go to the scroll, and nothing is lost
// by a mask holding still for the moment it moves past. Anything that is happening (a turn, the black hole) goes on.
let scrollingUntil = 0;
addEventListener('scroll', () => { scrollingUntil = performance.now() + 160; }, { passive: true, capture: true });
function wake() { if (!raf) raf = requestAnimationFrame(tick); }
function tick(now) {
  raf = 0;
  if (document.hidden || (shared && shared.lost)) return;
  let more = false;
  for (const m of all) if (m.step(now)) more = true;
  if (more) wake();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const m of all) m.last = performance.now(); wake(); } });

/* --------------------------------------------------------------- a mask */

const masks = new WeakMap();
// Only a mouse or a pen points: a finger touching the screen is not hovering, and following it made the hero whip
// round to face every tap.
let pointer = null;
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') { pointer = { x: e.clientX, y: e.clientY }; wake(); } }, { passive: true });
document.addEventListener('pointerleave', () => { pointer = null; wake(); });

const mounting = new WeakMap();
function mount(el) {
  if (!mounting.has(el)) mounting.set(el, build(el));
  return mounting.get(el);
}

async function build(el) {
  const kind = el.dataset.mask3d;
  const geom = GEOMETRY[kind] || 'scam';
  const S = renderer();
  if (!S) return null;   // no WebGL: the still render stays
  // Sharp on a high-density screen without drawing every physical pixel of it.
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const canvas = document.createElement('canvas');
  canvas.className = 'mask3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');

  const scene = new Scene();
  scene.environment = S.env;
  const camera = new PerspectiveCamera(20, 1, 0.1, 50);
  camera.position.set(0, 0, 7.6);

  const finishName = el.dataset.tint || kind;
  const f = FINISH[finishName] || FINISH.scam;
  const state = { radius: { value: 9 }, swirl: { value: 0 }, eat: { value: 0 }, rim: { value: new Color(f.rim) } };
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
  // Blender's lay pose (x -24, y 28, z 16 degrees), as the renders were made.
  const rest = lay ? { x: -0.42, y: 0.28, z: -0.49 } : { x: 0, y: el.classList.contains('plate__art') ? 0 : -0.18, z: 0 };
  // Blender's XYZ turn (masks.py --pose lay), carried into glTF's Y-up axes: the same order becomes YZX.
  holder.rotation.order = 'YZX';
  holder.rotation.set(rest.x, rest.y, rest.z);
  // The hero is framed exactly as its still picture (onyx.webp), so the 3D model takes over without a jump: measured
  // on the picture and the model side by side, the model sat smaller, higher and to the right.
  const frame = lay ? { x: -0.17, y: -0.19, s: 1.15 } : { x: 0, y: 0, s: 1 };
  holder.scale.setScalar(frame.s);
  pivot.position.x = frame.x;

  let eyes = null;
  try {
    const src = await model(geom);
    const m = src.clone(true);
    m.traverse((o) => { if (o.isMesh) { o.material = material; } });
    holder.add(m);
    if (el.hasAttribute('data-eyes')) {
      // Light inside the mask, seen through its eyes; and a glow over each eye, always lit and brighter as it watches.
      // The light is drawn last and over the metal's inside, so the eyes read clearly against a bright finish.
      const glowMat = new MeshBasicMaterial({ color: 0xffc83a, side: DoubleSide, toneMapped: false });
      const inner = new Mesh(new PlaneGeometry(1.25, 0.34), glowMat);
      inner.position.set(0, 0.2, 0.2);
      holder.add(inner);
      const tex = glowTexture();
      const halos = [-0.36, 0.36].map((x) => {
        const s = new Sprite(new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, toneMapped: false }));
        // Drawn over the metal: the eyes glow from any angle, not only when the mask faces the camera.
        s.renderOrder = 2;
        s.position.set(x, 0.2, 0.64);
        s.scale.set(0.7, 0.46, 1);
        holder.add(s);
        return s;
      });
      eyes = { glowMat, halos, level: 0.7 };
    }
  } catch {
    return null;
  }

  el.appendChild(canvas);
  el.classList.add('mask3d');

  /* -------- sizing, visibility */

  let w = 1;
  let h = 1;
  let dirty = true;
  const resize = () => {
    // Drawn at the box's size (the canvas is shown a little larger, sentinel.css --m3w/--m3h, so the mask can turn).
    const r = el.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr));
    h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    camera.aspect = w / h;
    // Keep the whole mask in frame whatever the box's shape.
    camera.fov = w / h < 0.72 ? 20 * (0.72 / (w / h)) : 20;
    camera.updateProjectionMatrix();
    dirty = true;
    wake();
  };
  let visible = false;
  new ResizeObserver(resize).observe(el);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) { mask.last = performance.now(); wake(); } }, { rootMargin: '80px' }).observe(el);
  resize();

  /* -------- motion: a calm spring toward where it should look */

  const reach = Number(el.dataset.look) || 0;
  const look = { x: 0, y: 0, vx: 0, vy: 0, w: 0, vw: 0 };
  let tx = 0;
  let ty = 0;
  let tw = 0;
  let drawnAt = 0;
  let shown = false;
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

  const draw = () => {
    fit(w, h);
    const r = S.r;
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setScissorTest(true);
    r.clear();
    r.render(scene, camera);
    ctx.clearRect(0, 0, w, h);
    // WebGL counts rows from the bottom: this mask's picture is the bottom-left w x h of the shared surface.
    ctx.drawImage(r.domElement, 0, S.h - h, w, h, 0, 0, w, h);
    if (!shown) { shown = true; requestAnimationFrame(() => el.classList.add('mask3d--ready')); }
  };

  const mask = {
    el,
    last: performance.now(),
    // One frame of this mask: true while it wants more frames.
    step(now) {
      if (!visible) return false;
      const dt = Math.min(0.05, Math.max(0, (now - mask.last) / 1000));
      mask.last = now;
      target();
      // A spring stiff enough to follow, damped so it settles without a swing, and soft enough that it turns rather
      // than snaps (a stiffer one whipped the mask round, worst of all at a phone's low frame rate).
      const k = 30;
      const c = 11;
      // Small steps, so a slow frame cannot throw the spring off.
      for (let left = dt; left > 0; left -= 1 / 120) {
        const s = Math.min(left, 1 / 120);
        look.vx += ((tx - look.x) * k - look.vx * c) * s; look.x += look.vx * s;
        look.vy += ((ty - look.y) * k - look.vy * c) * s; look.y += look.vy * s;
        look.vw += ((tw - look.w) * k * 0.6 - look.vw * c) * s; look.w += look.vw * s;
      }
      const t = (now - t0) / 1000;
      // Watching: the mask lifts part way out of its resting pose to face the pointer, and turns with it.
      const face = look.w * 0.5;
      holder.rotation.set(rest.x * (1 - face), rest.y * (1 - face), rest.z * (1 - face));
      const breathe = reduced ? 0 : Math.sin(t * 1.1) * 0.035 * (1 - look.w);
      // Masks that do not watch sway slowly on their own, like a piece turning on a display stand.
      const sway = !reach && !reduced ? { y: Math.sin(t * 0.42) * 0.34, x: Math.sin(t * 0.31) * 0.06 } : { y: 0, x: 0 };
      pivot.rotation.set(look.y * 0.45 + breathe * 0.4 + sway.x, look.x * 0.6 + sway.y + (reduced ? 0 : Math.sin(t * 0.55) * 0.05 * (1 - look.w)), -look.x * 0.05);
      pivot.position.y = frame.y + (reduced ? 0 : Math.sin(t * 0.9) * 0.05);
      if (eyes) {
        const want = 0.7 + 0.5 * look.w;
        eyes.level += (want - eyes.level) * Math.min(1, dt * 6);
        const flicker = 0.93 + 0.07 * Math.sin(t * 13) * Math.sin(t * 7.3);
        eyes.glowMat.color.setRGB(1.9 * eyes.level * flicker, 1.35 * eyes.level * flicker, 0.3 * eyes.level);
        for (const s of eyes.halos) s.material.opacity = Math.min(1, Math.max(0, (eyes.level - 0.15) * 1.25)) * flicker;
      }
      if (anim && anim(now) === false) anim = null;
      const moving = Math.abs(tx - look.x) + Math.abs(ty - look.y) + Math.abs(tw - look.w) + Math.abs(look.vx) + Math.abs(look.vy) > 0.0005;
      // Only drifting (breathing, swaying, the eyes' flicker): half the frames are plenty, and none while scrolling.
      const idle = !moving && !anim;
      const scrolling = now < scrollingUntil;
      if (dirty || !idle || (!scrolling && now - drawnAt > IDLE_MS)) { draw(); drawnAt = now; dirty = false; }
      return moving || Boolean(anim) || !reduced || Boolean(eyes);
    }
  };
  all.add(mask);
  wake();

  /* -------- controls */

  const setFinish = (name) => {
    const fin = FINISH[name] || FINISH.scam;
    material.color.set(fin.color);
    material.metalness = fin.metalness;
    material.roughness = fin.roughness;
    material.clearcoat = fin.clearcoat;
    material.envMapIntensity = fin.env;
    state.rim.value.set(fin.rim);
    rimL.color.set(fin.rim);
    rimR.color.set(fin.rim);
  };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const api = {
    el,
    // Straight to a finish (no transition).
    tint(name) { setFinish(name); dirty = true; wake(); },
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
      wake();
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
            // Consumed: the horizon grows from the middle, in step with the hole drawn over it (cosmos.js), until
            // nothing of the mask is left.
            const u = ease(e / out);
            // From nothing: no sudden bite out of the middle when the hole starts to feed.
            state.eat.value = 1.1 * u;
          } else if (e < out + gap) {
            state.eat.value = 0;
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
        wake();
      });
    }
  };
  masks.set(el, api);
  return api;
}

/* ------------------------------------------------------- start them all */

function start() {
  if (!('IntersectionObserver' in window) || !('ResizeObserver' in window)) return;
  const els = [...document.querySelectorAll('[data-mask3d]')];
  // The models every mask on the page needs, fetched now (they are cached), so a mask is ready before it is reached.
  for (const el of els) model(GEOMETRY[el.dataset.mask3d] || 'scam');
  // Each is built a screen or so before it is reached, in a quiet moment rather than in the middle of a scroll, so a
  // page with many masks does not start them all at once and none appears late.
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target;
      idle(() => mount(el).then((api) => { if (api) el.dispatchEvent(new CustomEvent('mask3d:ready', { detail: api })); }));
    }
  }, { rootMargin: '900px 0px' });
  els.forEach((el) => io.observe(el));
}

window.SentinelMask3D = { mount, get: (el) => masks.get(el) || null, scan: start, FINISH: Object.keys(FINISH) };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
