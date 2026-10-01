/*
 * The 3D backdrop: Sentinel's three masks, rendered from the same drawings as the 2D icons in masks.js, on one fixed
 * canvas behind the page. The scam mask is polished gold, the malware mask candy-red metal and the virus mask burnt
 * orange with its spores orbiting it. Behind them a slow nebula takes its colours from the section being read.
 *
 * Each section names a formation with data-pose and the masks glide between formations as the page scrolls, so every
 * section frames them differently: around the headline, peeking past the demo, one stepping forward for each colour
 * of the manifesto, circling the game and the security rings, rising behind the closing card. They turn to watch the
 * pointer, and lean with the speed of the scroll.
 *
 * Nothing depends on it: without WebGL, with reduced motion, or if anything here fails, the flat masks stay and the
 * page is unchanged. html.has-3d is only set once a frame has actually been drawn.
 */
(() => {
  'use strict';

  const T = window.SentinelThree;
  const Masks = window.SentinelMasks;
  const canvas = document.querySelector('[data-scene]');
  if (!T || !Masks || !canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const TAU = Math.PI * 2;
  const KINDS = ['scam', 'virus', 'malware'];
  const CAM_Z = 7;
  const FOV = 35;
  const HALF_H = Math.tan((FOV / 2) * Math.PI / 180) * CAM_Z;

  // Nebula palettes, as sRGB triples (the shader blends them as they are).
  const rgb = (hex) => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  const PAL = {
    gold: [rgb(0x7a5a1c), rgb(0xd4ae63), rgb(0x3a2a10)],
    ember: [rgb(0x6e1f12), rgb(0xf08a24), rgb(0xd4ae63)],
    blood: [rgb(0x4a0d14), rgb(0xe5484d), rgb(0x7a1c22)],
    dusk: [rgb(0x23204a), rgb(0xd4ae63), rgb(0x7a1c22)],
    tide: [rgb(0x10304a), rgb(0x3f7fa8), rgb(0xd4ae63)],
    mint: [rgb(0x0f3a2a), rgb(0x4cb782), rgb(0xd4ae63)],
    violet: [rgb(0x2e1648), rgb(0x9a6bd8), rgb(0xf08a24)],
    yellow: [rgb(0x5c4410), rgb(0xf5c542), rgb(0xd4ae63)],
    orange: [rgb(0x5a2008), rgb(0xf08a24), rgb(0xe5484d)],
    red: [rgb(0x4a0a10), rgb(0xe5484d), rgb(0xf08a24)]
  };

  /* ------------------------------------------------------------ formations */

  // A mask's place: x, y as a fraction of the half view (-1 left/bottom, 1 right/top), z its depth (negative is
  // further away), s its height as a fraction of the view height, rx/ry/rz radians, spin turns per second.
  const at = (x, y, z, s, rx = 0, ry = 0, rz = 0, spin = 0) => ({ x, y, z, s, rx, ry, rz, spin });
  // A formation places all three masks and colours the nebula. Fixed formations are plain objects; ones that follow a
  // page element or move with time are functions of the clock, resolved every frame.
  const form = (scam, virus, malware, pal, glow = 1) => ({ scam, virus, malware, pal: PAL[pal], glow });

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) / innerWidth * 2 - 1, y: 1 - (r.top + r.height / 2) / innerHeight * 2, h: r.height / innerHeight, w: r.width / innerWidth };
  };

  /** Three masks grouped around an element: offsets are in multiples of the element's height. */
  const around = (sel, layout, pal, glow) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return () => {
      const r = rect(el);
      const k = innerHeight / innerWidth;
      const place = ([dx, dy, z, sz, rx, ry, rz]) => at(r.x + dx * r.h * 2 * k, r.y + dy * r.h * 2, z, r.h * sz, rx, ry, rz);
      return form(place(layout.scam), place(layout.virus), place(layout.malware), pal, glow);
    };
  };

  /** The masks circling a point (or an element's centre) on a tilted ellipse. */
  const orbit = ({ sel, x = 0, y = 0, rx, ry, z = -1.5, depth = 1.6, s, speed = 0.18, pal, glow, fit }) => {
    const el = sel && document.querySelector(sel);
    if (sel && !el) return null;
    return (sec) => {
      let cx = x;
      let cy = y;
      let ex = rx;
      let ey = ry;
      let size = s;
      if (el) {
        const r = rect(el);
        cx = r.x; cy = r.y; ex = r.w * fit; ey = r.h * fit * 0.5; size = r.h * s;
      }
      const one = (i) => {
        const a = sec * speed + i * TAU / 3;
        return at(cx + Math.cos(a) * ex, cy + Math.sin(a) * ey, z + Math.sin(a) * depth, size, 0.1, -Math.cos(a) * 0.9, 0);
      };
      return form(one(0), one(1), one(2), pal, glow);
    };
  };

  const DESKTOP = {
    // Gathered round the headline: gold in front, red over its shoulder, orange below.
    hero: around('[data-hero-visual]', {
      scam: [0, 0.02, 0, 0.62, -0.05, -0.42, 0.03],
      malware: [-0.36, 0.34, -2.2, 0.5, 0.1, 0.5, 0.18],
      virus: [0.34, -0.3, -1.1, 0.44, -0.08, -0.7, -0.12]
    }, 'gold', 1),
    // Peeking past the edges of the demo window.
    stage: form(at(0.9, 0.22, -0.4, 0.4, 0.1, -0.75, -0.18), at(-0.9, -0.42, -1.2, 0.32, -0.1, 0.8, 0.2), at(-0.86, 0.5, -2, 0.34, 0.15, 0.7, 0.24), 'dusk', 0.8),
    // A slow parade behind the numbers.
    stats: form(at(-0.62, 0.05, -3, 0.34, 0.05, 0, 0, 0.12), at(0, 0.05, -3, 0.34, 0.05, 2.1, 0, 0.12), at(0.62, 0.05, -3, 0.34, 0.05, 4.2, 0, 0.12), 'ember', 0.9),
    // Lined up beside the heading in the order of the cards below.
    'masks-head': form(at(0.32, -0.02, 0, 0.36, 0.05, -0.55), at(0.6, 0.1, -0.9, 0.34, 0.05, -0.6), at(0.88, -0.04, -1.8, 0.36, 0.05, -0.65), 'ember', 1),
    // Each mask waits at the edge of its own card.
    trio: () => {
      const y = (t) => { const el = document.querySelector(`.mask-card[data-threat="${t}"]`); return el ? rect(el).y : 0; };
      return form(at(0.94, y('scam'), -0.6, 0.3, 0, -0.9, 0.1), at(0.94, y('virus'), -0.6, 0.3, 0, -0.9, -0.1), at(0.94, y('malware'), -0.6, 0.3, 0, -0.9, 0.1), 'blood', 0.9);
    },
    kinds: orbit({ rx: 0.82, ry: 0.42, z: -3.5, depth: 1.4, s: 0.26, speed: 0.16, pal: 'violet', glow: 0.8 }),
    // One mask steps forward for each colour while the others wait in the dark.
    manifesto: [
      form(at(0, 0.3, 0, 0.5, 0.05, -0.5), at(-0.75, 0.1, -7, 0.3, 0, 0.8), at(0.75, 0.1, -7, 0.3, 0, -0.8), 'yellow', 1.6),
      form(at(-0.75, 0.1, -7, 0.3, 0, 0.8), at(0, 0.3, 0, 0.5, 0.05, 2.6), at(0.75, 0.1, -7, 0.3, 0, -0.8), 'orange', 1.8),
      form(at(-0.75, 0.1, -7, 0.3, 0, 0.8), at(0.75, 0.1, -7, 0.3, 0, -0.8), at(0, 0.3, 0, 0.5, 0.12, TAU - 0.15), 'red', 2)
    ],
    // Small and stepped, like stages on a line.
    how: form(at(0.5, 0.55, -0.6, 0.2, -0.1, -0.7), at(0.7, 0.44, -1.2, 0.2, -0.1, -0.75), at(0.9, 0.33, -1.8, 0.2, -0.1, -0.8), 'tide', 0.9),
    game: orbit({ y: -0.05, rx: 0.86, ry: 0.5, z: -2, depth: 1.8, s: 0.3, speed: 0.22, pal: 'violet', glow: 1 }),
    everywhere: form(at(-0.55, 0.25, -2.6, 0.62, 0.1, 0.6, 0.1), at(0.6, -0.3, -3.4, 0.55, -0.1, -0.5, -0.1), at(0.15, 0.55, -4.4, 0.5, 0.2, -0.2, 0.05), 'mint', 0.9),
    // A line of masks crossing with the words.
    marquee: [
      form(at(-0.7, 0, -1, 0.3, 0, 0.4, 0.1), at(0, 0, -1, 0.3, 0, 0.4, -0.1), at(0.7, 0, -1, 0.3, 0, 0.4, 0.1), 'gold', 1.1),
      form(at(-0.4, 0, -1, 0.3, 0, Math.PI, -0.1), at(0.3, 0, -1, 0.3, 0, Math.PI, 0.1), at(1, 0, -1, 0.3, 0, Math.PI, -0.1), 'ember', 1.1)
    ],
    try: form(at(0.93, 0.5, -0.8, 0.22, 0, -0.9, 0.1), at(0.95, -0.02, -0.8, 0.22, 0, -0.9, -0.1), at(0.93, -0.54, -0.8, 0.22, 0, -0.9, 0.1), 'dusk', 0.8),
    // Low, looking up at the plans.
    pricing: form(at(-0.62, -0.78, -3, 0.3, -0.4, 0.3), at(0, -0.84, -3.6, 0.3, -0.4, 0), at(0.62, -0.78, -3, 0.3, -0.4, -0.3), 'gold', 0.8),
    security: orbit({ sel: '.lockart', fit: 0.55, z: -0.6, depth: 0.8, s: 0.2, speed: 0.3, pal: 'tide', glow: 0.9 }),
    faq: form(at(-0.88, 0.35, -1, 0.26, 0, 0.8, 0.1), at(0.88, -0.25, -1, 0.26, 0, -0.8, -0.1), at(0.9, 0.55, -2, 0.24, 0, -0.8, 0.1), 'dusk', 0.7),
    // Fanned out, rising behind the closing card.
    cta: form(at(-0.42, 0.42, -1.2, 0.34, 0.2, 0.35, 0.28), at(0, 0.5, -1.6, 0.36, 0.2, 0, 0), at(0.42, 0.42, -1.2, 0.34, 0.2, -0.35, -0.28), 'gold', 1.2),
    // Other pages: resting at the margins.
    page: form(at(0.82, 0.3, -0.6, 0.36, 0.05, -0.7, -0.1), at(-0.86, -0.3, -1.4, 0.3, 0, 0.7, 0.12), at(0.74, -0.6, -2.4, 0.3, 0.1, -0.5, 0.1), 'dusk', 0.8)
  };

  // Phones have no room beside the text: the masks keep to the edges, and come forward for the manifesto.
  const EDGE_A = form(at(0.78, 0.8, -1.5, 0.15, 0, -0.6), at(-0.8, 0.74, -2, 0.13, 0, 0.6), at(0.05, -0.86, -2.6, 0.13, 0.2, 0), 'dusk', 0.7);
  const EDGE_B = form(at(-0.78, 0.8, -1.5, 0.15, 0, 0.6), at(0.8, 0.7, -2, 0.13, 0, -0.6), at(-0.1, -0.86, -2.6, 0.13, 0.2, 0), 'ember', 0.7);
  const PHONE = {
    hero: around('[data-hero-visual]', {
      scam: [0, 0.02, 0, 0.66, -0.05, -0.3, 0.03],
      malware: [-0.5, 0.28, -2.2, 0.48, 0.1, 0.5, 0.18],
      virus: [0.5, -0.3, -1.1, 0.44, -0.08, -0.6, -0.12]
    }, 'gold', 1),
    manifesto: DESKTOP.manifesto.map((f) => ({ ...f, scam: { ...f.scam, s: f.scam.s * 0.6 }, virus: { ...f.virus, s: f.virus.s * 0.6 }, malware: { ...f.malware, s: f.malware.s * 0.6 } })),
    security: DESKTOP.security,
    stats: form(at(-0.6, 0.6, -3, 0.16, 0, 0, 0, 0.12), at(0, 0.66, -3, 0.16, 0, 2.1, 0, 0.12), at(0.6, 0.6, -3, 0.16, 0, 4.2, 0, 0.12), 'ember', 0.8),
    cta: form(at(-0.45, 0.72, -1.2, 0.18, 0.2, 0.35, 0.28), at(0, 0.78, -1.6, 0.2, 0.2, 0, 0), at(0.45, 0.72, -1.2, 0.18, 0.2, -0.35, -0.28), 'gold', 1)
  };

  /* -------------------------------------------------------------- renderer */

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return; // no WebGL: the flat masks stay
  }
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;

  const key = new T.DirectionalLight(0xfff1d6, 2.4);
  key.position.set(3, 4, 5);
  const fill = new T.DirectionalLight(0xa9c1ff, 0.5);
  fill.position.set(-4, -1, 3);
  const rim = new T.PointLight(0xffc35a, 40, 24);
  rim.position.set(-3, 3, -2);
  const under = new T.PointLight(0xffc35a, 0, 20);
  under.position.set(1.5, -2.6, 2.5);
  scene.add(key, fill, rim, under);

  /* ---------------------------------------------------------------- masks */

  // Every mask is drawn on the same 64-unit grid, so one scale keeps their faces the same size: the helmet runs from
  // y 11.6 to 49.4 and is centred on (32, 30.5).
  const UNIT = 1 / 38;

  /** Extrude SVG shapes, then curve them like a face so the metal catches the light. */
  function face(shapes) {
    let geo = new T.ExtrudeGeometry(shapes, { depth: 2.4, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.55, bevelSegments: 5, curveSegments: 24 });
    geo.translate(-32, -30.5, -1.2);
    // SVG y runs down; flipping z too keeps the faces pointing outward.
    geo.scale(UNIT, -UNIT, -UNIT);
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
    return geo;
  }

  const shapesOf = (markup) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${markup.replace(/currentColor/g, '#000')}</svg>`;
    return new T.SVGLoader().parse(svg).paths.map((p) => p.toShapes());
  };

  const MATERIAL = {
    // Polished gold.
    scam: new T.MeshPhysicalMaterial({ color: 0xe2b65e, metalness: 1, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.16, envMapIntensity: 1.35 }),
    // Burnt orange metal, a little brushed.
    virus: new T.MeshPhysicalMaterial({ color: 0xf2862a, metalness: 1, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 1.3 }),
    // Candy red: tinted metal under a deep clear coat.
    malware: new T.MeshPhysicalMaterial({ color: 0xd11f2b, metalness: 0.92, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 })
  };

  const G = Masks.GLYPHS;
  const rigs = {};
  let spores = null;

  function buildMasks() {
    // Scam: the plain helmet and its rivet.
    rigs.scam = new T.Group();
    rigs.scam.add(new T.Mesh(face(shapesOf(G.scam).flat()), MATERIAL.scam));

    // Malware: horns and the jagged jaw.
    rigs.malware = new T.Group();
    rigs.malware.add(new T.Mesh(face(shapesOf(G.malware).flat()), MATERIAL.malware));

    // Virus: the helmet, drawn at full size, with its spores as beads that orbit it.
    rigs.virus = new T.Group();
    const [helmet, ring] = shapesOf(G.virus);
    const head = new T.Mesh(face(helmet), MATERIAL.virus);
    head.scale.setScalar(1 / 0.82);
    rigs.virus.add(head);
    spores = new T.Group();
    const bead = new T.IcosahedronGeometry(0.058, 3);
    for (const shape of ring || []) {
      const pts = shape.getPoints(12);
      const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
      const m = new T.Mesh(bead, MATERIAL.virus);
      // Where the flat icon has them, close around the helmet.
      m.position.set((c.x - 32) * UNIT * 0.98, -(c.y - 31) * UNIT * 0.98, 0.12);
      m.userData.phase = Math.random() * TAU;
      spores.add(m);
    }
    rigs.virus.add(spores);
    for (const k of KINDS) scene.add(rigs[k]);
  }

  /* ------------------------------------------------------------- backdrop */

  // A slow, folded nebula in the section's colours, drawn first behind the masks. Its alpha lets the page colour
  // through, so it reads as light on the dark theme and as watercolour on the light one.
  const nebula = new T.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uA: { value: new T.Vector3(...PAL.gold[0]) },
      uB: { value: new T.Vector3(...PAL.gold[1]) },
      uC: { value: new T.Vector3(...PAL.gold[2]) },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uAspect: { value: 1 },
      uGlow: { value: 1 },
      uLight: { value: 0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }',
    fragmentShader: `
      precision highp float;
      uniform vec3 uA, uB, uC;
      uniform float uTime, uScroll, uAspect, uGlow, uLight;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vec2(vUv.x * uAspect, vUv.y + uScroll);
        float t = uTime * 0.035;
        vec2 q = vec2(fbm(p * 1.4 + vec2(t, -t)), fbm(p * 1.4 + vec2(-t, t) + 4.0));
        float n = fbm(p * 1.9 + q * 2.2);
        float veil = smoothstep(0.42, 0.95, fbm(p * 1.1 + q * 1.4 + 7.0 - t));
        vec3 col = mix(uA, uB, smoothstep(0.3, 0.85, n));
        col = mix(col, uC, veil * 0.6);
        // Thin bright folds where the noise crosses the middle, like silk catching light.
        float fold = 1.0 - smoothstep(0.0, 0.025, abs(n - 0.52));
        float a = pow(smoothstep(0.25, 0.9, n), 1.6) * 0.5 + fold * 0.22 + veil * 0.12;
        vec2 c = vUv - 0.5;
        a *= (1.0 - dot(c, c) * 1.3) * uGlow * mix(0.85, 0.42, uLight);
        gl_FragColor = vec4(col + fold * 0.25, clamp(a, 0.0, 0.85));
      }`
  });
  const backdrop = new T.Mesh(new T.PlaneGeometry(2, 2), nebula);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  /** Embers in the three colours, through the whole page depth, drifting up as the page scrolls. */
  function buildEmbers() {
    const n = innerWidth < 760 ? 420 : 1000;
    const pts = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);
    const tones = [new T.Color(0xd9b46a), new T.Color(0xf08a24), new T.Color(0xe5484d), new T.Color(0xf4e2b3)];
    for (let i = 0; i < n; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 18;
      pts[i * 3 + 1] = Math.random() * -44 + 7;
      pts[i * 3 + 2] = Math.random() * -9 + 2;
      const c = tones[i % 7 === 0 ? 2 : i % 5 === 0 ? 1 : i % 3 === 0 ? 3 : 0];
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const g = dot.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const mat = new T.PointsMaterial({ size: 0.055, map: new T.CanvasTexture(dot), vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending });
    return new T.Points(geo, mat);
  }

  /* --------------------------------------------------------- scroll poses */

  const anchors = [...document.querySelectorAll('[data-pose]')];
  let frames = [];
  let phone = false;

  // Each section holds its formation while it fills the middle of the screen, and the masks travel in between.
  function layout() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    nebula.uniforms.uAspect.value = w / h;
    phone = w < 760;
    frames = [];
    for (const el of anchors) {
      const name = el.dataset.pose;
      let f = phone ? PHONE[name] : DESKTOP[name];
      if (phone && !f) f = frames.length % 2 ? EDGE_A : EDGE_B;
      if (!f) continue;
      const r = el.getBoundingClientRect();
      // A pinned section taller than the screen plays its formations while it is pinned, in step with its text.
      const pinned = Array.isArray(f) && r.height > h;
      // The first section holds from the very top of the page.
      const start = !frames.length ? 0 : pinned ? r.top + scrollY : r.top + scrollY - h * 0.5;
      const end = Math.max(start, pinned ? r.bottom + scrollY - h : r.bottom + scrollY - h * 0.5);
      const list = Array.isArray(f) ? f : [f, f];
      list.forEach((q, i) => frames.push({ at: start + (end - start) * (i / (list.length - 1)), f: q }));
    }
    frames.sort((a, b) => a.at - b.at);
    if (!frames.length) frames.push({ at: 0, f: DESKTOP.page });
  }

  const ease = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const POSE_KEYS = ['x', 'y', 'z', 's', 'rx', 'ry', 'rz'];
  const blank = () => ({ x: 0, y: 0, z: -12, s: 0.3, rx: 0, ry: 0, rz: 0 });
  const target = { scam: blank(), virus: blank(), malware: blank(), pal: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], glow: 1 };
  const now = { scam: blank(), virus: blank(), malware: blank(), pal: PAL.gold.map((c) => c.slice()), glow: 1 };

  function aim(y, sec) {
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].at <= y) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const t = b.at > a.at ? ease(Math.min(1, Math.max(0, (y - a.at) / (b.at - a.at)))) : 0;
    const fa = typeof a.f === 'function' ? a.f(sec) : a.f;
    const fb = typeof b.f === 'function' ? b.f(sec) : b.f;
    for (const k of KINDS) {
      const pa = fa[k];
      const pb = fb[k];
      for (const p of POSE_KEYS) target[k][p] = lerp(pa[p], pb[p], t);
      // Formations that turn on the spot keep turning.
      target[k].ry += sec * TAU * lerp(pa.spin || 0, pb.spin || 0, t);
    }
    for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) target.pal[c][j] = lerp(fa.pal[c][j], fb.pal[c][j], t);
    target.glow = lerp(fa.glow, fb.glow, t);
  }

  /* ----------------------------------------------------------------- theme */

  // The light theme shows the nebula more quietly; read from the page colour so it follows any choice.
  function readTheme() {
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(document.body).backgroundColor) || [0, 0, 0, 0];
    nebula.uniforms.uLight.value = (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 > 0.5 ? 1 : 0;
  }
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', readTheme);

  /* ------------------------------------------------------------------ loop */

  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (ev) => { pointer.x = ev.clientX / innerWidth * 2 - 1; pointer.y = ev.clientY / innerHeight * 2 - 1; }, { passive: true });
  addEventListener('resize', layout);
  // Fonts and images move sections after the first layout.
  addEventListener('load', layout);
  if (document.fonts) document.fonts.ready.then(layout);
  new ResizeObserver(() => layout()).observe(document.body);

  let embers;
  let last = performance.now();
  let born = 0;
  let lastScroll = scrollY;
  let lean = 0;
  let first = true;
  let snapped = false;

  function place(rig, p, sec, intro, bob) {
    // Positions are given at the depth of the screen; a deeper mask is moved out so it still lands where it was put.
    const depth = (CAM_Z - p.z) / CAM_Z;
    const halfW = HALF_H * camera.aspect;
    const z = p.z - (1 - intro) * 16;
    rig.position.set(p.x * halfW * depth, p.y * HALF_H * depth + Math.sin(sec * 0.8 + bob) * 0.05, z);
    rig.scale.setScalar(Math.max(0.0001, p.s * HALF_H * 2));
    // They turn to watch the pointer, and lean with the speed of the scroll.
    rig.rotation.set(
      p.rx + pointer.y * 0.16 + lean * 0.5,
      p.ry + pointer.x * 0.32 + Math.sin(sec * 0.4 + bob) * 0.06 + (1 - intro) * TAU,
      p.rz + Math.sin(sec * 0.6 + bob) * 0.02 - lean * 0.2
    );
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const sec = t / 1000;
    if (!born) born = sec;
    aim(scrollY, sec);
    if (!snapped) {
      for (const k of KINDS) Object.assign(now[k], target[k]);
      snapped = true;
    }
    const kk = 1 - Math.exp(-dt * 4);
    for (const k of KINDS) for (const p of POSE_KEYS) now[k][p] = lerp(now[k][p], target[k][p], kk);
    for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) now.pal[c][j] = lerp(now.pal[c][j], target.pal[c][j], kk * 0.6);
    now.glow = lerp(now.glow, target.glow, kk * 0.6);

    const v = (scrollY - lastScroll) / Math.max(dt, 0.001) / innerHeight;
    lastScroll = scrollY;
    lean = lerp(lean, Math.max(-0.5, Math.min(0.5, v * 0.12)), 1 - Math.exp(-dt * 6));

    // The masks fly in from the dark one after another when the page opens.
    KINDS.forEach((k, i) => {
      const intro = ease(Math.min(1, Math.max(0, (sec - born - i * 0.22) / 1.6)));
      place(rigs[k], now[k], sec, intro, i * 2.1);
    });
    for (const s of spores ? spores.children : []) s.position.z = 0.12 + Math.sin(sec * 1.6 + s.userData.phase) * 0.06;
    if (spores) spores.rotation.z = sec * 0.25;

    // The light under the masks takes the section's colour.
    under.color.setRGB(...now.pal[1]);
    under.intensity = now.glow * 30;
    rim.color.setRGB(...now.pal[1]).lerp(new T.Color(0xffc35a), 0.5);

    const u = nebula.uniforms;
    u.uA.value.set(...now.pal[0]);
    u.uB.value.set(...now.pal[1]);
    u.uC.value.set(...now.pal[2]);
    u.uTime.value = sec;
    u.uScroll.value = scrollY / innerHeight * 0.12;
    u.uGlow.value = now.glow;

    embers.position.y = (scrollY / innerHeight) * 1.6;
    embers.rotation.y = sec * 0.01;

    renderer.render(scene, camera);
    if (first) { first = false; document.documentElement.classList.add('has-3d'); }
    requestAnimationFrame(frame);
  }

  try {
    buildMasks();
    embers = buildEmbers();
    scene.add(embers);
    readTheme();
    layout();
    requestAnimationFrame(frame);
  } catch {
    /* the flat masks stay */
  }
})();
