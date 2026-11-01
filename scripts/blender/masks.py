"""
Sentinel's three masks as studio product renders, built in Blender from the same drawings as the icons.

    python scripts/blender/masks.py --svg-dir <dir> --out <dir> [--mask scam|virus|malware|glass|pearl|onyx|all]
                                    [--tint yellow|orange|red] [--pose stand|lay] [--frames N] [--size PX] [--samples N]

The site uses: each of scam, virus and malware with --tint yellow, orange and red (the severity colours), and
--mask onyx --pose lay --yaw 16 for the hero. The renders are cropped and saved as web/assets/img/masks/*.webp.

Needs the Blender Python module (pip install bpy). The SVGs are the GLYPHS of web/assets/js/masks.js written
as files (scripts/blender/export-svgs.js does that). Each mask is extruded into a shell, remeshed finely so its edges
round like cast metal, given cast relief measured from the drawing's outlines (a lip framing every edge and eye, an
engraved line inside it, a swell and a centre ridge; relief()), curved like a face and lit as a product shot:
softboxes for reflections, a warm key and coloured rims, on a transparent background.

--glb makes the site's real-time model from that detailed mask, high to low: a 16,000-triangle copy with a UV map
gets the detail baked in as a normal map and an occlusion map (blender-agent-skills: retopology-uv, texture-baking,
export-pipelines). scripts/blender/mask_qa.py is the quality gate for the result. --web writes a still cropped as
web/assets/img/masks/ uses it.

--frames N renders a turntable of N frames (one full turn) for scroll-scrubbed rotation; otherwise one still.
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('--svg-dir', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--mask', default='all')
ap.add_argument('--frames', type=int, default=0)
ap.add_argument('--size', type=int, default=1200)
ap.add_argument('--samples', type=int, default=96)
ap.add_argument('--yaw', type=float, default=-22, help='still: turn of the mask in degrees')
ap.add_argument('--tip', type=float, default=-14)
ap.add_argument('--roll', type=float, default=16)
ap.add_argument('--tint', default='', choices=['', 'yellow', 'orange', 'red'], help='recolour the mask in a severity colour')
ap.add_argument('--pose', default='stand', choices=['stand', 'lay'], help='lay: tipped back and turned, lying on a surface')
ap.add_argument('--glb', action='store_true', help='export the mask as a glTF model (no render) for the site to light in real time')
ap.add_argument('--voxel', type=float, default=0.006, help='detail of the high model (the remesh voxel, on a mask 2 tall)')
ap.add_argument('--maps', type=int, default=1024, help='--glb: size of the baked normal and occlusion maps')
ap.add_argument('--keep-high', action='store_true', help='--glb: also write the high model and the maps, for checking the bake')
ap.add_argument('--env', action='store_true', help='render the studio itself as an equirectangular HDR (2:1, --size tall) for the live masks')
ap.add_argument('--web', action='store_true', help='still: also write it cropped as the site uses it, as .webp')
ap.add_argument('--image-format', default='WEBP', choices=['WEBP', 'AUTO', 'JPEG'], help='--glb: how the maps are stored')
ap.add_argument('--image-quality', type=int, default=95, help='--glb: quality of lossy maps')
args = ap.parse_args(argv)

# Colour, finish and the light around each mask.
LOOKS = {
    'scam': dict(svg='scam', base=(1.0, 0.71, 0.29), metal=1.0, rough=0.16, coat=0.4, rim=(1.0, 0.62, 0.25)),
    'malware': dict(svg='malware', base=(0.62, 0.015, 0.03), metal=0.85, rough=0.24, coat=1.0, rim=(1.0, 0.12, 0.1)),
    'virus': dict(svg='virus', base=(1.0, 0.3, 0.03), metal=1.0, rough=0.22, coat=0.7, rim=(1.0, 0.42, 0.08)),
    'glass': dict(svg='scam', glass=True, rim=(1.0, 0.78, 0.45)),
    # Ivory porcelain under a deep glaze, for the hero.
    'pearl': dict(svg='scam', base=(0.9, 0.85, 0.76), metal=0.0, rough=0.22, coat=1.0, sss=0.25, rim=(1.0, 0.8, 0.55)),
    # Black onyx, polished.
    'onyx': dict(svg='scam', base=(0.008, 0.007, 0.006), metal=0.0, rough=0.3, coat=0.6, rim=(1.0, 0.8, 0.55), world=0.05, key=0.22, rimk=0.3, lit=True),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = args.samples
    s.cycles.use_denoising = True
    s.render.film_transparent = True
    s.cycles.film_transparent_glass = False
    s.render.resolution_x = s.render.resolution_y = args.size
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast'
    return s


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


WIRE_STATIONS = 240
EASE = 0.007   # the radius every crease is eased by


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k / 4


def smax(a, b, k):
    return -smin(-a, -b, k)


def outlines(name):
    """The drawing's closed outlines, in helmet units: the helmet is 2 tall and centred. Sorted by area, largest first."""
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=os.path.join(args.svg_dir, f'{name}.svg'))
    polys = []
    for o in [o for o in bpy.data.objects if o not in before and o.type == 'CURVE']:
        for sp in o.data.splines:
            n = len(sp.bezier_points)
            pts = []
            for i in range(n):
                a, b = sp.bezier_points[i], sp.bezier_points[(i + 1) % n]
                c = [o.matrix_world @ v for v in (a.co, a.handle_right, b.handle_left, b.co)]
                for t in (j / 14 for j in range(14)):
                    q =(1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t * t * c[2] + t ** 3 * c[3]
                    pts.append((q.x, q.y))
            polys.append(np.array(pts))
        bpy.data.objects.remove(o)
    area = lambda p: abs(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])) / 2
    polys.sort(key=area, reverse=True)
    lo, hi = polys[0].min(0), polys[0].max(0)
    k, mid = 2 / (hi[1] - lo[1]), (lo + hi) / 2
    return [(p - mid) * k for p in polys]


def polygon_sdf(U, V, P):
    """Signed distance from every point of a grid to a closed outline, negative inside."""
    best = np.full(U.shape, 1e9, dtype=np.float32)
    inside = np.zeros(U.shape, dtype=bool)
    for (ax, ay), (bx, by) in zip(P, np.roll(P, -1, 0)):
        ex, ey = bx - ax, by - ay
        px, py = U - ax, V - ay
        t = np.clip((px * ex + py * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
        best = np.minimum(best, (px - ex * t) ** 2 + (py - ey * t) ** 2)
        inside ^= ((ay > V) != (by > V)) & (U < ax + (V - ay) * ex / (ey if ey else 1e-12))
    d = np.sqrt(best)
    return np.where(inside, -d, d)


def mitre_sdf(U, V, P):
    """Distance from a convex outline with its corners kept sharp however far out it is measured (a cut facet, not a
    rounded rail). An outline that is not convex (the jagged jaw) falls back to true distance."""
    n = np.roll(P, -1, 0) - P
    n = n[np.hypot(*n.T) > 1e-6]
    turn = n[:, 0] * np.roll(n[:, 1], -1) - n[:, 1] * np.roll(n[:, 0], -1)
    if turn.min() < -1e-5 and turn.max() > 1e-5:
        return polygon_sdf(U, V, P)
    n = n / np.hypot(*n.T)[:, None]
    side = 1 if turn.sum() > 0 else -1
    cut = np.max([(U - a[0]) * e[1] * side - (V - a[1]) * e[0] * side for a, e in zip(P, n)], 0, initial=-1e9)
    # Sharp corners, but a thin corner may not run out into a long spike.
    return np.maximum(cut, polygon_sdf(U, V, P) * 0.74)


def surface_nets(field, origin, h):
    """Turns a sampled distance field into a smooth closed mesh: one vertex in every cell the surface crosses, one quad
    across every grid edge it crosses. The vertices sit on the interpolated surface, so there are no voxel steps."""
    s = field < 0
    corners = sum(s[i:s.shape[0] - 1 + i, j:s.shape[1] - 1 + j, k:s.shape[2] - 1 + k].astype(np.uint8)
                  for i in (0, 1) for j in (0, 1) for k in (0, 1))
    cells = np.argwhere((corners > 0) & (corners < 8))
    index = np.full(corners.shape, -1, dtype=np.int64)
    index[tuple(cells.T)] = np.arange(len(cells))
    total, count, quads = np.zeros((len(cells), 3)), np.zeros(len(cells)), []
    shape = np.array(field.shape)
    for axis in range(3):
        a, b = [(axis + 1) % 3, (axis + 2) % 3]
        step = np.eye(3, dtype=np.int64)[axis]
        lo = tuple(slice(0, -1) if i == axis else slice(None) for i in range(3))
        hi = tuple(slice(1, None) if i == axis else slice(None) for i in range(3))
        grid = np.argwhere(s[lo] != s[hi])
        v0, v1 = field[tuple(grid.T)], field[tuple((grid + step).T)]
        t = v0 / (v0 - v1)
        cross = grid + t[:, None] * step
        ring = []
        for da, db in ((0, 0), (1, 0), (1, 1), (0, 1)):
            cell = grid.copy()
            cell[:, a] -= da
            cell[:, b] -= db
            ok = np.all(cell >= 0, 1) & np.all(cell < shape - 1, 1)
            ids = np.full(len(grid), -1, dtype=np.int64)
            ids[ok] = index[tuple(cell[ok].T)]
            hit = ids >= 0
            np.add.at(total, ids[hit], cross[hit])
            np.add.at(count, ids[hit], 1)
            ring.append(ids)
        ring = np.stack(ring, 1)
        keep = np.all(ring >= 0, 1)
        flip = ~s[tuple(grid[keep].T)]
        q = ring[keep]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    return (total / count[:, None]) * h + origin, np.concatenate(quads)


def to_object(name, verts, quads):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set('vertex_index', quads.astype(np.int32).ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set('loop_start', np.arange(0, quads.size, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def sweep(name, pts, radii, sides, closed=False):
    """A round section carried along a curve: closed into a ring, or capped at both ends. Gold wire, horn tips, the stud.
    Made directly, not from a field, so its edge is exactly even."""
    pts = np.asarray(pts, dtype=np.float64)
    n = len(pts)
    tangent = np.roll(pts, -1, 0) - np.roll(pts, 1, 0) if closed else np.gradient(pts, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    up = np.where(np.abs(tangent[:, 1:2]) > 0.9, (0.0, 0.0, 1.0), (0.0, 1.0, 0.0))
    side = np.cross(tangent, up)
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    other = np.cross(side, tangent)
    a = 2 * np.pi * np.arange(sides) / sides
    ring = (side[:, None] * np.cos(a)[None, :, None] + other[:, None] * np.sin(a)[None, :, None]) * np.asarray(radii)[:, None, None]
    verts = (pts[:, None] + ring).reshape(-1, 3)
    i, j = np.meshgrid(np.arange(n if closed else n - 1), np.arange(sides), indexing='ij')
    i1, j1 = (i + 1) % n, (j + 1) % sides
    quads = np.stack([i * sides + j, i1 * sides + j, i1 * sides + j1, i * sides + j1], -1).reshape(-1, 4).tolist()
    if not closed:
        k = len(verts)
        verts = np.concatenate([verts, pts[[0, -1]]])
        for jj in range(sides):
            jn = (jj + 1) % sides
            quads.append([k, jj, jn])
            quads.append([k + 1, (n - 1) * sides + jn, (n - 1) * sides + jj])
    return verts, quads


def joined(name, pieces):
    verts, faces, offset = [], [], 0
    for v, f in pieces:
        verts.append(v)
        faces += [[i + offset for i in q] for q in f]
        offset += len(v)
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.concatenate(verts).tolist(), [], faces)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def face(U, V):
    """The face, as how far forward the metal stands at every point of the front view: flat planes that meet in clean
    creases (a keel down the forehead and nose, temples, cheeks, a jaw falling to the chin), so a soft light slides
    across broad surfaces instead of tracing a rim round every shape."""
    au = np.sqrt(U * U + 0.0003)
    dome = 0.76 * np.sqrt(np.clip(1 - (U / 1.04) ** 2 - ((V - 0.02) / 1.28) ** 2, 0.01, 1))
    forehead = 0.82 - 0.40 * au - 0.36 * np.maximum(V - 0.30, 0)
    temple = 1.02 - 1.15 * au
    cheek = 0.74 - 0.62 * au + 0.40 * (V + 0.10)
    jaw = 0.62 - 0.92 * au + 0.86 * (V + 0.62)
    h = smin(dome, forehead, 0.05)
    for plane in (temple, cheek, jaw):
        h = smin(h, plane, 0.035)
    return h


def sculpt(kind, h=None, only=None):
    """Models the mask. The drawing is the front view: the helmet's outline, the eyes, the openings. Everything else is
    the object's own form: planes of a face, sockets cut deep with a floor, an eye lens set on that floor, a gold rim
    let into the surface, and for the malware mask horns swept back in real depth."""
    polys = outlines(look_svg(kind))
    helmet = polys[0]
    hmin, hmax = helmet.min(0), helmet.max(0)
    within = lambda c: hmin[0] < c[0] < hmax[0] and hmin[1] < c[1] < hmax[1]
    centres = [(p.mean(0), p) for p in polys[1:]]
    eyes = [p for c, p in centres if within(c) and 0 <= c[1] < 0.45]
    openings = [p for c, p in centres if within(c) and c[1] < 0]
    rivets = [p for c, p in centres if within(c) and c[1] >= 0.45]
    outside = [p for c, p in centres if not within(c)]
    horns = outside if kind == 'malware' else []
    spores = outside if kind == 'virus' else []

    h = h or args.voxel
    pad = 0.05
    all_pts = np.concatenate([helmet] + horns)
    lo = np.array([all_pts[:, 0].min() - pad - (0.15 if horns else 0), -1.0, all_pts[:, 1].min() - pad])
    hi = np.array([all_pts[:, 0].max() + pad + (0.15 if horns else 0), 0.75 if horns else 0.6, all_pts[:, 1].max() + pad])
    if spores:
        lo[[0, 2]] = -1.5
        hi[[0, 2]] = 1.5
    us = np.arange(lo[0], hi[0], h, dtype=np.float32)
    ys = np.arange(lo[1], hi[1], h, dtype=np.float32)
    vs = np.arange(lo[2], hi[2], h, dtype=np.float32)
    U, V = np.meshgrid(us, vs, indexing='ij')

    sil = polygon_sdf(U, V, helmet)
    eye = np.min([mitre_sdf(U, V, p) for p in eyes], 0)
    gap = np.min([mitre_sdf(U, V, p) for p in openings], 0)
    soft_eye = np.min([polygon_sdf(U, V, p) for p in eyes], 0)
    soft_gap = np.min([polygon_sdf(U, V, p) for p in openings], 0)
    H0 = face(U, V)
    # The sockets: a wide flat cut falling to each eye and opening, under a wedge of brow that ends in a clean crease.
    above = smooth(-0.02, 0.10, V - (0.36 - 0.42 * (0.60 - np.abs(U))))
    brow = 0.075 * np.clip(1 - np.abs(eye - 0.15) / 0.26, 0, 1) * above
    H = H0 + brow - 0.15 * np.clip(1 - eye / 0.15, 0, 1) - 0.10 * np.clip(1 - gap / 0.11, 0, 1)
    stud = None
    if rivets:
        c = rivets[0].mean(0)
        q = np.hypot(U - c[0], V - c[1])
        r = (rivets[0].max(0)[0] - rivets[0].min(0)[0]) / 2
        H = H - 0.03 * np.clip(1 - (q - r) / 0.05, 0, 1)
        stud = (c, q, r, float(H0[np.argmin(np.abs(us - c[0])), np.argmin(np.abs(vs - c[1]))]))
    # Every crease eased by one small radius, the same everywhere: a cast edge that catches a clean line of light,
    # never a kink finer than the sampling.
    fx, fz = np.fft.rfftfreq(H.shape[1], h), np.fft.fftfreq(H.shape[0], h)
    H = np.fft.irfft2(np.fft.rfft2(H) * np.exp(-2 * (np.pi * EASE) ** 2 * (fx[None, :] ** 2 + fz[:, None] ** 2)), H.shape).astype(np.float32)
    gu, gv = np.gradient(H, h)
    slope = np.sqrt(1 + gu * gu + gv * gv)
    socket = np.minimum(-H0 + 0.30, -0.06)
    # The light in each eye: not the whole opening but an almond along it, narrowing to nothing at both ends.
    slit = np.full(U.shape, 1.0, dtype=np.float32)
    for p in eyes:
        c = p.mean(0)
        axis = np.linalg.svd(p - c)[2][0]
        s_, n_ = (U - c[0]) * axis[0] + (V - c[1]) * axis[1], -(U - c[0]) * axis[1] + (V - c[1]) * axis[0]
        slit = np.minimum(slit, np.abs(n_) - 0.034 * (1 - np.minimum((s_ / 0.19) ** 2, 1.4)))
    pit = np.minimum(-H0 + 0.40, -0.06)

    # The malware mask's horns: swept tapered curves, leaving the temples, climbing and running back in depth. The front
    # view follows the drawn wedge.
    curves = []
    for p in horns:
        c = p.mean(0)
        tip = p[np.argmax(np.hypot(*p.T))]
        root = c + (c - tip) / 2
        a, b, e, f = ((*(root * 0.82), -0.02), (*(root * 1.2 + (root - tip) * 0.05), -0.22), (*(tip * 0.9 + root * 0.1), 0.02), (*tip, 0.62))
        t = np.linspace(0, 1, 72)[:, None]
        pts = (1 - t) ** 3 * np.array(a) + 3 * (1 - t) ** 2 * t * np.array(b) + 3 * (1 - t) * t * t * np.array(e) + t ** 3 * np.array(f)
        curves.append(pts[:, [0, 2, 1]])  # u, y, v

    def horn_field(y):
        best, when = np.full(U.shape, 9.0, dtype=np.float32), np.zeros(U.shape, dtype=np.float32)
        for pts in curves:
            for i in range(len(pts) - 1):
                a, e = pts[i], pts[i + 1] - pts[i]
                pu, py, pv = U - a[0], y - a[1], V - a[2]
                t = np.clip((pu * e[0] + py * e[1] + pv * e[2]) / (e @ e), 0, 1)
                w = (i + t) / (len(pts) - 1)
                d = np.sqrt((pu - e[0] * t) ** 2 + (py - e[1] * t) ** 2 + (pv - e[2] * t) ** 2) - (0.2 * (1 - w) ** 0.8 + 0.003)
                when = np.where(d < best, w, when)
                best = np.minimum(best, d)
        return best, when

    horn_at = horn_field if curves else None
    # The virus mask's spores: gold beads, each carried on a stalk out of the helmet's edge, drawn in close.
    beads = [(*(p.mean(0) * 0.66), -0.1) for p in spores]
    beads = [(x, w, z) for x, z, w in beads]

    def stalks(y):
        best = np.full(U.shape, 9.0, dtype=np.float32)
        for x, w, z in beads:
            e = np.array((-x * 0.6, -w + 0.02, -z * 0.6))
            pu, py, pv = U - x, y - w, V - z
            t = np.clip((pu * e[0] + py * e[1] + pv * e[2]) / (e @ e), 0, 1)
            best = np.minimum(best, np.sqrt((pu - e[0] * t) ** 2 + (py - e[1] * t) ** 2 + (pv - e[2] * t) ** 2) - (0.022 + 0.05 * t ** 2))
        return best

    def body(y):
        d = (-H - y) / slope
        d = smax(d, y - (0.14 - 0.22 * (U * U + 0.5 * V * V)), 0.03)
        d = smax(d, sil + 0.5 * np.maximum(y + 0.16, 0), 0.022)
        d = smax(d, -smax(eye, y - socket - 0.05, 0.012), 0.008)
        d = smax(d, -smax(gap, y - pit - 0.05, 0.012), 0.008)
        if horn_at:
            d = smin(d, horn_at(y)[0], 0.07)
        if beads:
            d = smin(d, stalks(y), 0.05)
        return d

    def liner(y):
        plate = lambda cut, floor: smax(smax(cut - 0.02, floor - y, 0.004), y - (floor + 0.09), 0.004)
        return np.minimum(plate(soft_eye, socket), plate(soft_gap, pit))

    def ember(y):
        return smax(smax(slit, socket - 0.016 + 1.4 * np.maximum(slit, -0.03) - y, 0.005), y - (socket + 0.02), 0.004)

    # The drawing's whole height, horns included, becomes 2 tall, as the icon fits its box; depth is centred on the pivot.
    drawn = np.concatenate([helmet] + horns)
    mid = (drawn.min(0) + drawn.max(0)) / 2
    size = 2 / (drawn[:, 1].max() - drawn[:, 1].min())
    shift = np.array((mid[0], -0.32, mid[1]))
    out = []
    def lookup(u, v):
        i = np.clip(((u - lo[0]) / h).astype(int), 0, len(us) - 1)
        j = np.clip(((v - lo[2]) / h).astype(int), 0, len(vs) - 1)
        return H[i, j]

    def trim():
        # The gold: a wire let into the metal just inside the outline (found by walking the drawn outline in along the
        # distance field), the seated stud, the horn tips and the spores.
        wire = helmet.astype(np.float64)
        for _ in range(12):
            i = np.clip(((wire[:, 0] - lo[0]) / h).astype(int), 1, len(us) - 2)
            j = np.clip(((wire[:, 1] - lo[2]) / h).astype(int), 1, len(vs) - 2)
            grad = np.stack([sil[i + 1, j] - sil[i - 1, j], sil[i, j + 1] - sil[i, j - 1]], 1) / (2 * h)
            grad /= np.linalg.norm(grad, axis=1, keepdims=True) + 1e-9
            wire -= grad * (sil[i, j] + 0.05)[:, None]
        path = np.stack([wire[:, 0], -lookup(wire[:, 0], wire[:, 1]) - 0.006, wire[:, 1]], 1)
        # Even stations along it, then eased, so the sampled grid leaves no tremble in the line.
        seg = np.linalg.norm(np.roll(path, -1, 0) - path, axis=1)
        at = np.r_[0, np.cumsum(seg)]
        even = np.linspace(0, at[-1], WIRE_STATIONS, endpoint=False)
        path = np.stack([np.interp(even, at, np.r_[path[:, k], path[0, k]]) for k in range(3)], 1)
        kernel = np.hanning(15)
        kernel /= kernel.sum()
        path = np.stack([np.convolve(np.r_[path[-7:, k], path[:, k], path[:7, k]], kernel, 'valid') for k in range(3)], 1)
        pieces = [sweep('wire', path, np.full(len(path), 0.016), 8, closed=True)]
        if stud:
            c, _q, r, top = stud
            ring = [(0.05, 1.0), (-0.012, 1.0), (-0.03, 0.97), (-0.048, 0.84), (-0.06, 0.62), (-0.067, 0.34), (-0.069, 0.02)]
            pieces.append(sweep('stud', [(c[0], -top + o, c[1]) for o, _ in ring], [r * k for _, k in ring], 32))
        for pts in curves:
            cap = pts[len(pts) * 3 // 5:]
            w = np.linspace(0.6, 1, len(cap))
            pieces.append(sweep('tip', cap, 0.2 * (1 - w) ** 0.8 + 0.009, 14))
        for x, w, z in beads:
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.125)
            v = np.array([q.co[:] for q in bm.verts]) + (x, w, z)
            f = [[q.index for q in fc.verts] for fc in bm.faces]
            bm.free()
            pieces.append((v, f))
        pieces = [((v - shift) * size, f) for v, f in pieces]
        return joined('trim', pieces)

    for name, fn in (('body', body), ('trim', None), ('liner', liner), ('ember', ember)):
        if only and name != only:
            continue
        if name == 'trim':
            out.append(trim())
            continue
        field = np.stack([fn(y) for y in ys], 1)
        verts, quads = surface_nets(field, lo, h)
        out.append(to_object(name, (verts - shift) * size, quads))
    return out


def look_svg(kind):
    return LOOKS[kind]['svg']


def smooth(a, b, d):
    t = np.clip((d - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def build(look):
    parts = sculpt(look['kind'])
    gold = material({**TINTS['yellow'], 'svg': 'trim'})
    dark = material(dict(svg='liner', base=(0.004, 0.0035, 0.003), metal=0.0, rough=0.42, coat=0.0))
    ember = material(dict(svg='ember', base=(0.01, 0.008, 0.006), metal=0.0, rough=0.2, coat=0.0))
    if look.get('lit'):
        b = ember.node_tree.nodes['Principled BSDF']
        nt = ember.node_tree
        # Hottest where the lens bulges toward the eye, falling to a deep ember at its edge.
        ramp = nt.nodes.new('ShaderNodeLayerWeight')
        ramp.inputs['Blend'].default_value = 0.35
        heat = nt.nodes.new('ShaderNodeMix')
        heat.data_type = 'RGBA'
        heat.inputs['A'].default_value = (1.0, 0.34, 0.02, 1)
        heat.inputs['B'].default_value = (0.7, 0.07, 0.0, 1)
        nt.links.new(ramp.outputs['Facing'], heat.inputs['Factor'])
        nt.links.new(heat.outputs['Result'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 1.1
    for o, m in zip(parts, (material(look), gold, dark, ember)):
        o.data.materials.append(m)
    rig = bpy.data.objects.new('rig', None)
    bpy.context.scene.collection.objects.link(rig)
    for o in parts:
        o.parent = rig
    return rig

def material(look):
    m = bpy.data.materials.new(look['svg'])
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    if look.get('glass'):
        b.inputs['Base Color'].default_value = (0.96, 0.97, 1.0, 1)
        b.inputs['Transmission Weight'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.03
        b.inputs['IOR'].default_value = 1.5
        b.inputs['Coat Weight'].default_value = 0.3
        return m
    b.inputs['Base Color'].default_value = (*look['base'], 1)
    b.inputs['Metallic'].default_value = look['metal']
    b.inputs['Roughness'].default_value = look['rough']
    b.inputs['Coat Weight'].default_value = look['coat']
    b.inputs['Coat Roughness'].default_value = 0.04
    if look.get('sss'):
        b.inputs['Subsurface Weight'].default_value = look['sss']
        b.inputs['Subsurface Radius'].default_value = (0.4, 0.3, 0.2)
    # A faint cast texture breaks up the reflections.
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 60
    noise.inputs['Detail'].default_value = 8
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.035
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def softbox(name, loc, size, energy, color=(1, 1, 1), look_at=(0, 0, 0), visible_light=True):
    bpy.ops.object.light_add(type='AREA', location=loc)
    lamp = bpy.context.view_layer.objects.active
    lamp.name = name
    lamp.data.shape = 'RECTANGLE'
    lamp.data.size, lamp.data.size_y = size
    lamp.data.energy = energy
    lamp.data.color = color
    d = Vector(look_at) - Vector(loc)
    lamp.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return lamp


def card(loc, size, strength, color=(1, 1, 1)):
    # Emissive panels the camera never sees: they exist to draw long highlights on the metal.
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    p = bpy.context.view_layer.objects.active
    p.scale = (size[0], size[1], 1)
    d = Vector((0, 0, 0)) - Vector(loc)
    p.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    m = bpy.data.materials.new('card')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    p.data.materials.append(m)
    p.visible_camera = False
    return p


def studio(look):
    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    # A dim studio: darker below, warm grey above. Never seen directly (the film is transparent) but it is what
    # the metal reflects and the glass refracts between the softboxes.
    nt = world.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.006, 0.006, 0.008, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.22, 0.2, 0.17, 1)
    nt.links.new(tc.outputs['Normal'], sep.inputs[0])
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs['From Min'].default_value = -1
    nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
    nt.links.new(mp.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = look.get('world', 1.4 if look.get('glass') else 0.6)
    rim = look['rim']
    k = look.get('key', 1.0)
    softbox('key', (-2.6, -3.4, 3.0), (2.4, 1.6), 900 * k, (1.0, 0.95, 0.88))
    softbox('rimL', (-3.2, 2.2, 0.6), (0.6, 3.0), 650 * look.get('rimk', 1), rim)
    softbox('rimR', (3.2, 2.0, 1.2), (0.6, 3.0), 520 * look.get('rimk', 1), rim)
    softbox('fill', (3.0, -3.0, -0.6), (2.0, 2.0), 140 * k, (0.75, 0.82, 1.0))
    softbox('top', (0, 0.4, 3.6), (3, 1), 260, (1, 0.96, 0.9))
    card((-3.0, -2.0, 0.6), (0.7, 4.0), 6 * k, rim if k < 1 else (1, 1, 1))
    card((2.8, -2.4, 0.2), (0.5, 4.0), 4 * k, rim if k < 1 else (1, 1, 1))
    card((0, -3.2, 2.6), (4.0, 0.5), 3.5 * k)
    card((0, -2.6, -2.4), (4.0, 0.8), 0.9, rim)


def camera():
    bpy.ops.object.camera_add(location=(0, -9.0, 0.15))
    cam = bpy.context.view_layer.objects.active
    cam.rotation_euler = (math.radians(89.0), 0, 0)
    cam.data.lens = 105
    bpy.context.scene.camera = cam


# Severity colours: the same metal, recoloured, so a mask can show how sure Sentinel is.
TINTS = {
    'yellow': dict(base=(1.0, 0.72, 0.13), metal=1.0, rough=0.18, coat=0.5, rim=(1.0, 0.8, 0.3)),
    'orange': dict(base=(1.0, 0.3, 0.03), metal=1.0, rough=0.22, coat=0.7, rim=(1.0, 0.45, 0.1)),
    'red': dict(base=(0.62, 0.015, 0.03), metal=0.85, rough=0.24, coat=1.0, rim=(1.0, 0.12, 0.1)),
}


def render(kind):
    s = reset()
    look = {**LOOKS[kind], **TINTS[args.tint], 'kind': kind} if args.tint else {**LOOKS[kind], 'kind': kind}
    rig = build(look)
    studio(look)
    camera()
    os.makedirs(args.out, exist_ok=True)
    if args.frames:
        for i in range(args.frames):
            rig.rotation_euler = (0, 0, math.radians(360 * i / args.frames))
            s.render.filepath = os.path.join(args.out, f'{kind}-{i:03d}.png')
            bpy.ops.render.render(write_still=True)
    else:
        rig.rotation_euler = (math.radians(args.tip), math.radians(args.roll), math.radians(args.yaw)) if args.pose == 'lay' else (0, 0, math.radians(args.yaw))
        name = kind + ('-lay' if args.pose == 'lay' else '') + (f'-{args.tint}' if args.tint else '')
        s.render.filepath = os.path.join(args.out, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        if args.web:
            web_still(s.render.filepath, os.path.join(args.out, ('onyx' if args.pose == 'lay' else name) + '.webp'), args.pose == 'lay')


def web_still(src, dest, lay):
    """The render as the site uses it (web/assets/img/masks/*.webp): the mask cropped to its own outline and fitted,
    centred, into the picture's box. A standing mask fills 658x942 of a 700x1000 picture; the lying hero fills its
    788x896 picture to a pixel of the edge, as the hero's 3D model is framed to match it (mask3d.src.js `frame`)."""
    import numpy as np
    img = bpy.data.images.load(src)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ys, xs = np.where(px[:, :, 3] > 0.004)
    crop = px[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    cw, ch, bw, bh = (788, 896, 786, 894) if lay else (700, 1000, 658, 942)
    k = min(bw / crop.shape[1], bh / crop.shape[0])
    sw, sh = max(1, round(crop.shape[1] * k)), max(1, round(crop.shape[0] * k))
    part = bpy.data.images.new('part', crop.shape[1], crop.shape[0], alpha=True)
    part.pixels[:] = crop.ravel()
    part.scale(sw, sh)
    small = np.array(part.pixels[:], dtype=np.float32).reshape(sh, sw, 4)
    canvas = np.zeros((ch, cw, 4), dtype=np.float32)
    x0, y0 = (cw - sw) // 2, (ch - sh) // 2
    canvas[y0:y0 + sh, x0:x0 + sw] = small
    out = bpy.data.images.new('still', cw, ch, alpha=True)
    out.pixels[:] = canvas.ravel()
    # Saved through the scene's output settings, the only way the WebP quality is honoured. The galaxy's pictures,
    # these among them, have a size budget (tests/galaxy.test.js).
    st = bpy.context.scene.render.image_settings
    st.file_format = 'WEBP'
    st.color_mode = 'RGBA'
    st.quality = 78
    out.save_render(dest, scene=bpy.context.scene)


LOW = dict(body=(0.012, 13000), liner=(0.008, 400), ember=(0.009, 300))   # each part's low model: its voxel and triangles


def bake_image(name, colour, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def export_glb(kind):
    """The mask for the site, made as game artists make a hero prop (blender-texture-baking, high to low): sculpt() gives
    the high parts; a simplified copy of each, joined with one UV map, is the low model, and the high shape is baked onto
    it as a normal map and an occlusion map. Each part keeps a material named for it: the site gives each its finish
    (web/assets/js/mask3d.js); the file carries only the shape and those two maps."""
    s = reset()
    highs = sculpt(kind)
    # Only the body carries maps. The low model is the same sculpture sampled coarsely and then simplified, not the high
    # one collapsed: its vertices start on the true surface, so the normal map has no lumps to correct.
    parts = []
    for part in highs:
        if part.name == 'trim':
            low = part.copy()
            low.data = part.data.copy()
            s.collection.objects.link(low)
        else:
            # Sampling can pinch two sheets into one edge in a thin place; a slightly different grid does not.
            for attempt in range(8):
                low = sculpt(kind, LOW[part.name][0] * (1 + 0.011 * attempt), part.name)[0]
                bm = bmesh.new()
                bm.from_mesh(low.data)
                pinched = sum(len(e.link_faces) != 2 for e in bm.edges)
                bm.free()
                if not pinched:
                    break
                bpy.data.objects.remove(low)
            else:
                low = sculpt(kind, LOW[part.name][0], part.name)[0]
                rem = low.modifiers.new('remesh', 'REMESH')
                rem.mode = 'VOXEL'
                rem.voxel_size = LOW[part.name][0]
                select_only([low])
                bpy.ops.object.modifier_apply(modifier='remesh')
            tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
            dec = low.modifiers.new('decimate', 'DECIMATE')
            dec.ratio = min(1, LOW[part.name][1] / tris)
            dec.use_collapse_triangulate = True
            select_only([low])
            bpy.ops.object.modifier_apply(modifier='decimate')
        low.name = f'{part.name}-low'
        mat = bpy.data.materials.new(part.name)
        mat.use_nodes = True
        low.data.materials.clear()
        low.data.materials.append(mat)
        low.data.polygons.foreach_set('use_smooth', [True] * len(low.data.polygons))
        parts.append(low)
    low = parts[0]
    low.name = 'mask'
    mat = low.data.materials[0]
    high = highs[0]
    high.data.materials.clear()
    high.data.materials.append(bpy.data.materials.new('high'))
    select_only([low])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake (blender-texture-baking): rays leave a little outside the low surface and land on the high one. Close enough
    # that the gold rim, a hair above the metal, never catches a ray meant for the metal.
    s.render.bake.use_selected_to_active = True
    s.render.bake.cage_extrusion = 0.02
    s.render.bake.max_ray_distance = 0.05
    s.render.bake.margin = 8
    s.render.bake.margin_type = 'EXTEND'
    maps = {}
    for kind_of, colour in (('NORMAL', False), ('AO', False)):
        # Occlusion changes slowly across the surface: half the size is plenty.
        img = bake_image(f'{LOOKS[kind]["svg"]}-{kind_of.lower()}', colour, args.maps if kind_of == 'NORMAL' else args.maps // 2)
        maps[kind_of] = img
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        mat.node_tree.nodes.active = node
        # Both from the high model. The low one is invisible to every ray while baking: its own faces, just outside
        # the high surface, would otherwise shadow it in blotches.
        s.cycles.samples = 16 if kind_of == 'NORMAL' else 160
        for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
            setattr(low, flag, False)
        select_only([high, low])
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind_of, normal_space='TANGENT')
    # Wired the way the glTF exporter reads them: the normal map through a Normal Map node, the occlusion through
    # its glTF Material Output group.
    group = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if not group.interface.items_tree:
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    images = {n.image: n for n in nt.nodes if n.type == 'TEX_IMAGE'}
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(images[maps['NORMAL']].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    gnode = nt.nodes.new('ShaderNodeGroup')
    gnode.node_tree = group
    nt.links.new(images[maps['AO']].outputs['Color'], gnode.inputs['Occlusion'])
    # The gold, the liner and the ember have no maps: they join here, after the bake, the body's material staying first.
    select_only(parts)
    bpy.ops.object.join()
    low = bpy.context.view_layer.objects.active
    low.name = 'mask'

    select_only([low])
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f'{LOOKS[kind]["svg"]}.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_materials='EXPORT', export_yup=True, export_texcoords=True,
                              export_normals=True, export_tangents=False, export_image_format=args.image_format,
                              export_image_quality=args.image_quality)
    if args.keep_high:
        for image in maps.values():
            image.filepath_raw = os.path.join(args.out, f'{image.name}.png')
            image.file_format = 'PNG'
            image.save()
        select_only([high])
        bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f'{LOOKS[kind]["svg"]}-high.glb'), export_format='GLB',
                                  use_selection=True, export_materials='NONE', export_yup=True)


def export_env(kind):
    """The studio as the mask sees it, for the site's live masks (web/assets/models/studio-<kind>.hdr): the same world,
    softboxes and cards as the stills, photographed from where the mask stands as a panorama, without the mask.
    The panorama's middle faces Blender's +X, which is where three.js puts the middle of an equirectangular map."""
    s = reset()
    s.render.film_transparent = False
    s.cycles.use_denoising = False
    s.render.resolution_x, s.render.resolution_y = args.size * 2, args.size
    studio(LOOKS[kind])
    # The softboxes and cards are seen in the metal, so they are seen here.
    for o in s.objects:
        o.visible_camera = True
    bpy.ops.object.camera_add(location=(0, 0, 0))
    cam = bpy.context.view_layer.objects.active
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    s.camera = cam
    st = s.render.image_settings
    st.file_format = 'HDR'
    st.color_mode = 'RGB'
    os.makedirs(args.out, exist_ok=True)
    s.render.filepath = os.path.join(args.out, f'studio-{kind}.hdr')
    bpy.ops.render.render(write_still=True)


for kind in (LOOKS if args.mask == 'all' else [args.mask]):
    if args.env:
        export_env(kind)
    elif args.glb:
        export_glb(kind)
    else:
        render(kind)
