/*
 * Home page 3D: one gold Sentinel mask on a fixed canvas behind the page. Each section names a pose (data-pose) and
 * the mask glides between them as the page scrolls, so every section frames it differently. The hero pose follows
 * the [data-hero-visual] slot, so the layout decides where it sits at every width.
 *
 * Nothing depends on it: without WebGL, with reduced motion, or if anything here fails, the static gold mask in the
 * hero stays and the page is unchanged. html.has-3d is only set once a frame has actually been drawn.
 */
(() => {
  'use strict';

  const T = window.SentinelThree;
  const Masks = window.SentinelMasks;
  const canvas = document.querySelector('[data-scene]');
  if (!T || !Masks || !canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const GOLD = 0xffc35a;
  const YELLOW = 0xf5c542;
  const ORANGE = 0xf08a24;
  const RED = 0xe5484d;
  const TAU = Math.PI * 2;

  // x, y: centre as a fraction of the half view (-1 left/bottom, 1 right/top). s: height as a fraction of the view.
  // rx, ry, rz: radians. tint: colour of the light under the mask, ti its strength.
  const pose = (x, y, s, rx, ry, rz, tint, ti) => ({ x, y, s, rx, ry, rz, tint: new T.Color(tint), ti });
  // A pose that sits over a page element (fit: the mask's height as a fraction of the element's) and follows it.
  const follow = (sel, fit, rx, ry, rz, tint, ti) => {
    const el = document.querySelector(sel);
    return el && { el, fit, x: 0, y: 0, s: 0, rx, ry, rz, tint: new T.Color(tint), ti };
  };
  const OFF_R = pose(1.9, 0.1, 0.4, 0, -1.2, 0, GOLD, 0);
  const OFF_L = pose(-1.9, -0.1, 0.4, 0, 1.2, 0, GOLD, 0);
  const DESKTOP = {
    hero: follow('[data-hero-visual]', 0.92, -0.06, -0.38, 0.03, GOLD, 0.3),
    // Half hidden behind the demo window, looking in from the right.
    stage: pose(0.8, 0.3, 0.5, 0.1, -0.7, -0.18, GOLD, 0.3),
    stats: pose(-0.62, 0, 0.42, 0.1, 0.75, 0, GOLD, 0.3),
    'masks-head': pose(0.6, -0.05, 0.42, 0.05, -0.6, 0, YELLOW, 0.9),
    trio: OFF_R,
    // One full turn while the three colours are read out.
    manifesto: [pose(0, 0.28, 0.46, 0.05, -0.5, 0, YELLOW, 2), pose(0, 0.28, 0.48, 0.05, 2.6, 0, ORANGE, 2.2), pose(0, 0.28, 0.5, 0.12, TAU - 0.15, 0, RED, 2.6)],
    how: pose(0.72, 0.45, 0.3, -0.1, -0.8, 0, GOLD, 0.3),
    game: OFF_L,
    everywhere: pose(0.62, 0.2, 0.42, 0.15, -0.5, 0, GOLD, 0.3),
    marquee: [pose(0, 0, 0.32, 0, 0, 0.1, GOLD, 0.4), pose(0, 0, 0.32, 0, Math.PI, -0.1, GOLD, 0.4)],
    try: OFF_R,
    pricing: OFF_L,
    security: follow('.lockart', 0.4, 0, -0.35, 0, GOLD, 0.6),
    faq: OFF_R,
    // Rising from behind the closing card's corner.
    cta: pose(0.66, -0.2, 0.44, 0.2, -0.5, -0.22, GOLD, 0.5)
  };
  // Phones have no room beside the text: the mask keeps to the hero, the manifesto and the close.
  const PHONE = {
    hero: DESKTOP.hero,
    security: DESKTOP.security,
    stage: pose(0, 0.8, 0.5, 0.5, 0, 0, GOLD, 0.2),
    manifesto: DESKTOP.manifesto.map((p) => ({ ...p, y: 0.3, s: p.s * 0.7 })),
    cta: pose(0, 0.7, 0.36, 0.35, 0, 0, GOLD, 0.4)
  };

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return; // no WebGL: the static mask stays
  }
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  const halfH = Math.tan((35 / 2) * Math.PI / 180) * 6;
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;

  const key = new T.DirectionalLight(0xfff1d6, 2.4);
  key.position.set(3, 4, 5);
  const rim = new T.PointLight(GOLD, 40, 20);
  rim.position.set(-3, 2, -2);
  const tint = new T.PointLight(GOLD, 0, 20);
  tint.position.set(1.5, -2.2, 2.5);
  scene.add(key, rim, tint);

  const rig = new T.Group();
  rig.add(buildMask());
  scene.add(rig);
  const dust = buildDust();
  scene.add(dust);

  /** The scam helmet from masks.js, extruded, then curved like a face so the gold catches the light. */
  function buildMask() {
    const svg = Masks.svg('scam').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const shapes = new T.SVGLoader().parse(svg).paths.flatMap((p) => T.SVGLoader.createShapes(p));
    let geo = new T.ExtrudeGeometry(shapes, { depth: 2.4, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.55, bevelSegments: 5, curveSegments: 24 });
    geo.scale(1, -1, -1); // SVG y runs down; flipping z too keeps the faces pointing outward
    geo.center();
    const box = new T.Box3().setFromBufferAttribute(geo.attributes.position);
    const size = box.getSize(new T.Vector3());
    geo.scale(1 / size.y, 1 / size.y, 1 / size.y);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo = new T.TessellateModifier(0.05, 8).modify(geo);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + 0.3 * (1 - (x * x) / 0.16) + 0.08 * (1 - (y * y) / 0.3));
    }
    geo.deleteAttribute('normal');
    geo = T.mergeVertices(geo, 1e-4);
    geo.computeVertexNormals();
    geo.center();
    const gold = new T.MeshPhysicalMaterial({ color: 0xe2b65e, metalness: 1, roughness: 0.24, clearcoat: 0.5, clearcoatRoughness: 0.18, envMapIntensity: 1.35 });
    return new T.Mesh(geo, gold);
  }

  /** Gold dust through the whole page depth, drifting up as the page scrolls. */
  function buildDust() {
    const n = innerWidth < 760 ? 500 : 1100;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 16;
      pts[i * 3 + 1] = Math.random() * -40 + 6;
      pts[i * 3 + 2] = Math.random() * -8 + 2;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const g = dot.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const mat = new T.PointsMaterial({ size: 0.05, map: new T.CanvasTexture(dot), color: 0xd9b46a, transparent: true, opacity: 0.75, depthWrite: false, blending: T.AdditiveBlending });
    return new T.Points(geo, mat);
  }

  /* ------------------------------------------------------------ scroll poses */

  const anchors = [...document.querySelectorAll('[data-pose]')];
  let frames = [];

  // A following pose is placed over its element as it is right now.
  function resolve(p) {
    if (!p.el) return p;
    const r = p.el.getBoundingClientRect();
    p.x = (r.left + r.width / 2) / innerWidth * 2 - 1;
    p.y = 1 - (r.top + r.height / 2) / innerHeight * 2;
    p.s = (r.height / innerHeight) * p.fit;
    return p;
  }

  // Each section holds its pose while it fills the middle of the screen, and the mask travels in between.
  function layout() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const phone = w < 760;
    frames = [];
    for (const el of anchors) {
      const name = el.dataset.pose;
      const p = phone ? (PHONE[name] || (frames.length % 2 ? OFF_R : OFF_L)) : DESKTOP[name];
      if (!p) continue;
      const r = el.getBoundingClientRect();
      // A pinned section taller than the screen plays its poses while it is pinned, in step with its text.
      const pinned = Array.isArray(p) && r.height > h;
      // The first section holds from the very top of the page.
      const start = !frames.length ? 0 : pinned ? r.top + scrollY : r.top + scrollY - h * 0.5;
      const end = Math.max(start, pinned ? r.bottom + scrollY - h : r.bottom + scrollY - h * 0.5);
      const list = Array.isArray(p) ? p : [p, p];
      list.forEach((q, i) => frames.push({ at: start + (end - start) * (i / (list.length - 1)), p: q }));
    }
    frames.sort((a, b) => a.at - b.at);
  }

  const ease = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const target = { ...OFF_R, tint: new T.Color(GOLD) };
  const now = { ...OFF_R, tint: new T.Color(GOLD) };

  function aim(y) {
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].at <= y) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const t = b.at > a.at ? ease(Math.min(1, Math.max(0, (y - a.at) / (b.at - a.at)))) : 0;
    const pa = resolve(a.p);
    const pb = resolve(b.p);
    for (const k of ['x', 'y', 's', 'rx', 'ry', 'rz', 'ti']) target[k] = lerp(pa[k], pb[k], t);
    target.tint.copy(pa.tint).lerp(pb.tint, t);
  }

  /* ------------------------------------------------------------------ loop */

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (ev) => { pointer.x = ev.clientX / innerWidth * 2 - 1; pointer.y = ev.clientY / innerHeight * 2 - 1; }, { passive: true });
  addEventListener('resize', layout);
  // Fonts and images move sections after the first layout.
  addEventListener('load', layout);
  if (document.fonts) document.fonts.ready.then(layout);
  new ResizeObserver(() => layout()).observe(document.body);

  let last = performance.now();
  let first = true;
  let snapped = false;
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    aim(scrollY);
    if (!snapped) { Object.assign(now, target, { tint: now.tint.copy(target.tint) }); snapped = true; }
    const k = 1 - Math.exp(-dt * 4.5);
    for (const key of ['x', 'y', 's', 'rx', 'ry', 'rz', 'ti']) now[key] = lerp(now[key], target[key], k);
    now.tint.lerp(target.tint, k);

    const halfW = halfH * camera.aspect;
    const sec = t / 1000;
    rig.position.set(now.x * halfW, now.y * halfH + Math.sin(sec * 0.8) * 0.05, 0);
    rig.scale.setScalar(now.s * halfH * 2);
    rig.rotation.set(now.rx + pointer.y * 0.12, now.ry + pointer.x * 0.25 + Math.sin(sec * 0.4) * 0.06, now.rz + Math.sin(sec * 0.6) * 0.02);
    tint.color.copy(now.tint);
    tint.intensity = now.ti * 40;
    rim.color.copy(now.tint).lerp(new T.Color(GOLD), 0.5);
    dust.position.y = (scrollY / innerHeight) * 1.6;
    dust.rotation.y = sec * 0.01;

    renderer.render(scene, camera);
    if (first) { first = false; document.documentElement.classList.add('has-3d'); }
    requestAnimationFrame(frame);
  }

  try {
    layout();
    requestAnimationFrame(frame);
  } catch {
    /* the static mask stays */
  }
})();
