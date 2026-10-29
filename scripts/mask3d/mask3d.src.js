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
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, MeshPhysicalMaterial, Color, Group, Mesh, PlaneGeometry,
  MeshBasicMaterial, AdditiveBlending, CanvasTexture, SpriteMaterial, Sprite, SRGBColorSpace, AgXToneMapping, DoubleSide
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CAMERA, POSES, halfView, drift } from './pose.js';

const BASE = (document.currentScript && document.currentScript.src) ? new URL('../models/', document.currentScript.src).href : '/assets/models/';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// How often a mask that is only drifting (breathing, swaying, its eyes flickering) is redrawn: slow motion needs few
// frames, and on a phone fewer still (the drift is the same, the phone stays cool).
const IDLE_MS = matchMedia('(pointer: coarse)').matches ? 66 : 33;
// Once nothing has happened for a while (no pointer, no scroll, no turn or colour change, the entrance done), the
// masks rest: they keep drifting, drawn up to fifteen times a second (ten on a phone), and the page's main thread and
// the battery get the rest. Any pointer move or scroll wakes them at once.
const SETTLE_MS = 2500;
const REST_MS = matchMedia('(pointer: coarse)').matches ? 100 : 66;

// Finishes, matching the Blender renders (masks.py LOOKS and TINTS). studio: which of Sentinel's studios the finish
// reflects (web/assets/models/studio-*.hdr, masks.py --env): the gold one, or the onyx one, with its key light and
// room turned down so the black lacquer stays black and only the softboxes and gold cards show in it.
const FINISH = {
  onyx: { color: '#0b0a09', metalness: 0, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.03, rim: '#ffb455', studio: 'onyx' },
  scam: { color: '#f2b64b', metalness: 1, roughness: 0.16, clearcoat: 0.4, clearcoatRoughness: 0.03, rim: '#ffa04a', studio: 'scam' },
  virus: { color: '#ff5a10', metalness: 1, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.03, rim: '#ff7a2a', studio: 'scam' },
  malware: { color: '#a1040c', metalness: 0.85, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03, rim: '#ff2a20', studio: 'scam' },
  yellow: { color: '#ffbf1f', metalness: 1, roughness: 0.18, clearcoat: 0.5, clearcoatRoughness: 0.03, rim: '#ffd060', studio: 'scam' },
  orange: { color: '#ff5a0a', metalness: 1, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.03, rim: '#ff7a24', studio: 'scam' },
  red: { color: '#a3030b', metalness: 0.85, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03, rim: '#ff2a20', studio: 'scam' }
};
const GEOMETRY = { onyx: 'scam', scam: 'scam', virus: 'virus', malware: 'malware' };

/* ------------------------------------------------------------- models */

const loader = new GLTFLoader();
const models = new Map();
const model = (name) => {
  if (!models.has(name)) models.set(name, loader.loadAsync(`${BASE}${name}.glb`).then((g) => g.scene));
  return models.get(name);
};

// Sentinel's studio, as the stills are lit (masks.py --env): the panorama of its softboxes and cards, prefiltered once
// for every roughness. The metal reflects what the stills' metal reflects, not three.js's grey room.
const studios = new Map();
const studio = (name) => {
  if (!studios.has(name)) {
    studios.set(name, new HDRLoader().loadAsync(`${BASE}studio-${name}.hdr`).then((tex) => {
      const env = shared.pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      return env;
    }));
  }
  return studios.get(name);
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
    // As Blender's camera: AgX at exposure 0. The light is all in the studio's panorama, as bright as it is there.
    r.toneMappingExposure = 1;
    // Reading each shader's log after it is built made the browser finish every build there and then, in one long
    // pause (getProgramInfoLog, 0.85 s on a CI runner); the shaders are fixed and known to build.
    r.debug.checkShaderErrors = false;
    r.outputColorSpace = SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    shared = { r, pmrem: new PMREMGenerator(r), w: 0, h: 0, lost: false };
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
let awakeUntil = 0;
let rest = 0;
addEventListener('scroll', () => { scrollingUntil = performance.now() + 160; stir(); }, { passive: true, capture: true });
function wake() {
  if (rest) { clearTimeout(rest); rest = 0; }
  if (!raf) raf = requestAnimationFrame(tick);
}
// Something happened: full motion for a while.
function stir() { awakeUntil = performance.now() + SETTLE_MS; wake(); }
function tick(now) {
  raf = 0;
  if (document.hidden || (shared && shared.lost)) return;
  const resting = now > awakeUntil;
  const t = performance.now();
  let busy = false;
  let drift = false;
  for (const m of all) {
    const s = m.step(now, resting);
    if (s === 2) busy = true; else if (s) drift = true;
  }
  // At rest, nothing asks for the next frame: a timer does, a few times a second, and further apart where drawing is
  // slow (a computer drawing 3D without a graphics card), so resting masks never take more than a quarter of the time.
  if (busy || (drift && !resting)) wake();
  else if (drift) rest = setTimeout(wake, Math.max(REST_MS, (performance.now() - t) * 3));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const m of all) m.last = performance.now(); stir(); } });

/* --------------------------------------------------------------- a mask */

const masks = new WeakMap();
// Only a mouse or a pen points: a finger touching the screen is not hovering, and following it made the hero whip
// round to face every tap.
let pointer = null;
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') { pointer = { x: e.clientX, y: e.clientY }; stir(); } }, { passive: true });
document.addEventListener('pointerleave', () => { pointer = null; stir(); });

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
  const lay = el.dataset.pose === 'lay';
  const { rest, frame, zoom } = lay ? POSES.lay : el.classList.contains('plate__art') ? POSES.plate : POSES.stand;
  const canvas = document.createElement('canvas');
  canvas.className = 'mask3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 50);
  camera.position.set(0, 0, CAMERA.z);

  const finishName = el.dataset.tint || kind;
  const f = FINISH[finishName] || FINISH.scam;
  const state = { radius: { value: 9 }, swirl: { value: 0 }, eat: { value: 0 }, rim: { value: new Color(f.rim) } };
  const material = new MeshPhysicalMaterial({
    color: new Color(f.color), metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness
  });
  swallowable(material, state);

  // pivot: where the mask looks; holder: its resting pose.
  const pivot = new Group();
  const holder = new Group();
  pivot.add(holder);
  scene.add(pivot);
  // Blender's XYZ turn (masks.py --pose lay), carried into glTF's Y-up axes: the same order becomes YZX.
  holder.rotation.order = 'YZX';
  holder.rotation.set(rest.x, rest.y, rest.z);
  holder.scale.setScalar(frame.s);
  pivot.position.x = frame.x;

  let eyes = null;
  try {
    const [src, env] = await Promise.all([model(geom), studio(f.studio)]);
    scene.environment = env;
    const m = src.clone(true);
    // The model's own maps, baked in Blender from the detailed mask (masks.py --glb): the normal map carries the
    // bevels, rims and ridges smaller than a triangle, under the lacquer too; the occlusion map darkens the eyes'
    // depth. The finish (colour, metal, lacquer) stays the site's.
    m.traverse((o) => {
      if (!o.isMesh) return;
      const baked = o.material;
      if (baked && baked.normalMap && !material.normalMap) {
        material.normalMap = baked.normalMap;
        material.normalScale.copy(baked.normalScale);
        material.clearcoatNormalMap = baked.normalMap;
        material.clearcoatNormalScale.copy(baked.normalScale);
      }
      if (baked && baked.aoMap && !material.aoMap) material.aoMap = baked.aoMap;
      o.material = material;
    });
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
  // Room to turn (pose.js zoom): the canvas is shown larger and the camera sees as much wider.
  if (zoom !== 1) canvas.style.scale = String(zoom);

  /* -------- sizing, visibility */

  let w = 1;
  let h = 1;
  let dirty = true;
  const resize = () => {
    // Drawn at the size the canvas is shown (sentinel.css --m3w/--m3h, a little larger than the box, times the zoom),
    // pixel for pixel: drawn at the box's size and stretched over the larger canvas, it was soft.
    w = Math.max(1, Math.round(canvas.offsetWidth * zoom * dpr));
    h = Math.max(1, Math.round(canvas.offsetHeight * zoom * dpr));
    canvas.width = w;
    canvas.height = h;
    camera.aspect = w / h;
    // The whole mask in frame whatever the box's shape and however it turns (tests/mask-frame.test.js).
    camera.fov = (Math.atan(halfView(w / h, zoom)) * 360) / Math.PI;
    camera.updateProjectionMatrix();
    dirty = true;
    stir();
  };
  let visible = false;
  new ResizeObserver(resize).observe(el);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) { mask.last = performance.now(); stir(); } }, { rootMargin: '80px' }).observe(el);
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
    mask.draws++;
    if (!shown) { shown = true; requestAnimationFrame(() => el.classList.add('mask3d--ready')); }
  };

  const mask = {
    el,
    last: performance.now(),
    draws: 0,
    onScreen: () => visible,
    // One frame of this mask: 2 while it is moving (every frame wanted), 1 while it only drifts, 0 when it is still.
    step(now, resting) {
      if (!visible) return 0;
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
      // Breathing, and for masks that do not watch a slow sway, like a piece turning on a display stand.
      const d = drift(t, look, !reach, reduced);
      pivot.rotation.set(d.x, d.y, d.z);
      pivot.position.y = frame.y + d.lift;
      if (eyes) {
        const want = 0.7 + 0.5 * look.w;
        eyes.level += (want - eyes.level) * Math.min(1, dt * 6);
        const flicker = 0.93 + 0.07 * Math.sin(t * 13) * Math.sin(t * 7.3);
        eyes.glowMat.color.setRGB(1.9 * eyes.level * flicker, 1.35 * eyes.level * flicker, 0.3 * eyes.level);
        for (const s of eyes.halos) s.material.opacity = Math.min(1, Math.max(0, (eyes.level - 0.15) * 1.25)) * flicker;
      }
      if (anim && anim(now) === false) anim = null;
      const moving = Math.abs(tx - look.x) + Math.abs(ty - look.y) + Math.abs(tw - look.w) + Math.abs(look.vx) + Math.abs(look.vy) > 0.0005;
      // Only drifting (breathing, swaying, the eyes' flicker): half the frames are plenty, fewer at rest, and none
      // while scrolling. (At rest the timer is a little late or early: a frame's slack.)
      const idle = !moving && !anim;
      const scrolling = now < scrollingUntil;
      const every = resting ? REST_MS - 8 : IDLE_MS;
      if (dirty || !idle || (!scrolling && now - drawnAt > every)) { draw(); drawnAt = now; dirty = false; }
      return !idle ? 2 : (!reduced || eyes) ? 1 : 0;
    }
  };
  all.add(mask);
  stir();

  /* -------- controls */

  let current = finishName;
  const setFinish = (name) => {
    current = name;
    const fin = FINISH[name] || FINISH.scam;
    material.color.set(fin.color);
    material.metalness = fin.metalness;
    material.roughness = fin.roughness;
    material.clearcoat = fin.clearcoat;
    state.rim.value.set(fin.rim);
    // Into or out of onyx: that finish's studio (fetched once, the first time any mask needs it).
    studio(fin.studio).then((env) => { if (current === name) { scene.environment = env; dirty = true; stir(); } }, () => {});
  };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const api = {
    el,
    // Straight to a finish (no transition).
    tint(name) { setFinish(name); dirty = true; stir(); },
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
      stir();
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
        stir();
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

window.SentinelMask3D = {
  mount, get: (el) => masks.get(el) || null, scan: start, FINISH: Object.keys(FINISH),
  // For the site's checks (scripts/verify-web/45-mask-rest.js): whether the masks rest, and how often each (or el's) was
  // drawn.
  state: (el) => ({ resting: performance.now() > awakeUntil, masks: [...all].filter((m) => !el || m.el === el).map((m) => ({ kind: m.el.dataset.mask3d, draws: m.draws, onScreen: m.onScreen() })) })
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
