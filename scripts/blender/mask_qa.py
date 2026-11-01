"""
The quality gate for the site's 3D masks (web/assets/models/*.glb), run by Blender with no window:

    node scripts/blender/export-svgs.js <svgs>
    MASK_QA_SVGS=<svgs> blender --background --factory-startup --python scripts/blender/mask_qa.py -- <out-dir> <model.glb> [...]

For each model it imports the file as the site receives it, checks it with numbers and draws it, so a change to the
masks is judged on both:

  build    closed and manifold (no holes, no edge shared by three faces), every face pointing outward, no collapsed
           faces, a UV map inside the unit square on the body, a normal map and an occlusion map of sensible size, a
           triangle budget. These follow the asset QA gate of the blender-agent-skills (blender-asset-qa).
  form     what a mask that merely passes the above can still get wrong, and every mask before 1.19.2 did: its four parts
           are there; the eyes sit far back in real sockets and the socket hides them from the side; the front view is
           still the drawing; horns are round in section, not cut-out wedges; and the surface, seen through its own
           normals with the baked map applied, is calm planes rather than a tangle of rims and ribs.
  pictures <name>-<finish>-<view>-<dark|light>.png: front, turn (three-quarter), eyes (close-up, where a coarse model shows
           its facets first) on a dark page and a light one, in each finish the site shows, and <name>-wire.png.

Writes <out-dir>/report.json and exits with status 1 when any model fails a check.
"""
import json
import math
import os
import sys
from collections import Counter

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT, FILES = argv[0], argv[1:]
MAX_TRIS = 24000          # all meshes of one mask together
MAX_TEXTURE = 2048        # pixels on a side
SIZE = int(os.environ.get('MASK_QA_SIZE', '640'))
SAMPLES = int(os.environ.get('MASK_QA_SAMPLES', '24'))
SVGS = os.environ['MASK_QA_SVGS']
# The form gate. Thresholds sit between the last extruded masks and the modelled ones (both measured, see the report).
MIN_RECESS = 0.12         # how far the eye sits behind the brow, on a mask 2 tall
MIN_HIDDEN = 0.85         # share of the eye the socket hides from 70 degrees to the side
MIN_OVERLAP = 0.92        # front view against the drawing (intersection over union)
MIN_HORN_ROUND = 0.5      # how much a horn's depth changes across it, as a share of its deepest
MIN_CALM = 0.3            # share of the front view's metal that is calm (calm())


# base colour, metal, roughness, lacquer: the site's finishes (mask3d.src.js FINISH), and each model in the ones it wears.
FINISHES = {'gold': ((0.95, 0.68, 0.3), 1.0, 0.2, 0.4), 'onyx': ((0.008, 0.007, 0.006), 0.0, 0.3, 0.6),
            'red': ((0.62, 0.015, 0.03), 0.85, 0.24, 1.0), 'orange': ((1.0, 0.3, 0.03), 1.0, 0.22, 0.7)}
WORN = {'scam': ('gold', 'onyx'), 'malware': ('red',), 'virus': ('orange',)}
PARTS = {'trim': ((1.0, 0.71, 0.29), 1.0, 0.2, 0.0), 'liner': ((0.004, 0.0035, 0.003), 0.0, 0.42, 0.0), 'ember': ((0.004, 0.0035, 0.003), 0.0, 0.3, 0.0)}
PAGES = {'dark': (0.03, 0.026, 0.022), 'light': (0.9, 0.88, 0.85)}


def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def check(objs):
    """Numbers for one model; returns (metrics, errors)."""
    errors = []
    bm = bmesh.new()
    for o in objs:
        part = bmesh.new()
        part.from_mesh(o.data)
        part.transform(o.matrix_world)
        me = bpy.data.meshes.new('tmp')
        part.to_mesh(me)
        bm.from_mesh(me)
        part.free()
        bpy.data.meshes.remove(me)
    # A glTF file splits a vertex wherever its UVs or normals differ (every UV seam): weld those back before judging
    # whether the surface is closed.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bm.verts.ensure_lookup_table()
    edges = Counter(len(e.link_faces) for e in bm.edges)
    directed = Counter((l.vert.index, l.link_loop_next.vert.index) for f in bm.faces for l in f.loops)
    # A closed shell whose faces point outward encloses a positive volume.
    tri = bm.copy()
    bmesh.ops.triangulate(tri, faces=tri.faces[:])
    volume = sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) / 6 for f in tri.faces)
    m = {
        'tris': len(tri.faces),
        'boundary_edges': edges.get(1, 0),
        'nonmanifold_edges': sum(c for k, c in edges.items() if k > 2),
        'inconsistent_normal_edges': sum(1 for c in directed.values() if c > 1),
        'degenerate_faces': sum(1 for f in tri.faces if f.calc_area() < 1e-9),
        'volume': round(volume, 4),
    }
    tri.free()
    bm.free()
    if m['tris'] > MAX_TRIS:
        errors.append(f"{m['tris']} triangles, over the budget of {MAX_TRIS}")
    for k in ('boundary_edges', 'nonmanifold_edges', 'inconsistent_normal_edges'):
        if m[k]:
            errors.append(f'{m[k]} {k.replace("_", " ")}')
    if m['degenerate_faces'] > m['tris'] * 0.001:
        errors.append(f"{m['degenerate_faces']} collapsed faces")
    if m['volume'] <= 0:
        errors.append('faces point inward (negative volume)')
    # UVs: present, inside the unit square, and every face with some area.
    uv_out = uv_zero = 0
    for o in objs:
        me = o.data
        if not me.uv_layers:
            errors.append(f'{o.name}: no UV map')
            continue
        uv = me.uv_layers.active.data
        # Only the body is mapped; the gold, the liner and the ember have no maps.
        body = [i for i, slot in enumerate(o.material_slots) if slot.material and slot.material.name.startswith('body')]
        for p in me.polygons:
            if p.material_index not in body:
                continue
            pts = [uv[i].uv for i in p.loop_indices]
            uv_out += sum(1 for q in pts if q.x < -1e-3 or q.y < -1e-3 or q.x > 1.001 or q.y > 1.001)
            area = sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y for i in range(len(pts)))
            uv_zero += abs(area) < 1e-12
    m['uv_outside'] = uv_out
    m['uv_zero_area'] = uv_zero
    if uv_out:
        errors.append(f'{uv_out} UV points outside the unit square')
    if uv_zero > m['tris'] * 0.002:
        errors.append(f'{uv_zero} faces with no UV area')
    # Textures: a normal map and an occlusion map, power-of-two sized and within budget.
    maps = {}
    for o in objs:
        for slot in o.material_slots:
            if not slot.material or not slot.material.node_tree:
                continue
            for n in slot.material.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image:
                    w, h = n.image.size
                    role = 'normal' if any(l.to_node.type == 'NORMAL_MAP' for l in n.outputs['Color'].links) else 'other'
                    maps[n.image.name] = {'size': [w, h], 'role': role}
    m['textures'] = maps
    if not any(t['role'] == 'normal' for t in maps.values()):
        errors.append('no normal map')
    if len(maps) < 2:
        errors.append('no occlusion map')
    for name, t in maps.items():
        w, h = t['size']
        if w > MAX_TEXTURE or h > MAX_TEXTURE or w & (w - 1) or h & (h - 1):
            errors.append(f'texture {name} is {w}x{h}')
    return m, errors


def drawing(name):
    """The drawing's outer outlines, in the model's units: helmet 2 tall and centred, horns with it, spores left out
    (they are drawn in close on the model), scaled as masks.py scales it."""
    bpy.ops.import_curve.svg(filepath=os.path.join(SVGS, f'{name}.svg'))
    polys = []
    for o in [o for o in bpy.data.objects if o.type == 'CURVE']:
        for sp in o.data.splines:
            pts, n = [], len(sp.bezier_points)
            for i in range(n):
                a, b = sp.bezier_points[i], sp.bezier_points[(i + 1) % n]
                c = [o.matrix_world @ v for v in (a.co, a.handle_right, b.handle_left, b.co)]
                for t in (j / 12 for j in range(12)):
                    q = (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t * t * c[2] + t ** 3 * c[3]
                    pts.append((q.x, q.y))
            polys.append(np.array(pts))
    polys.sort(key=lambda p: -(np.ptp(p[:, 0]) * np.ptp(p[:, 1])))
    helmet = polys[0]
    lo, hi = helmet.min(0), helmet.max(0)
    outer = [p for p in polys[1:] if not (lo[0] < p[:, 0].mean() < hi[0] and lo[1] < p[:, 1].mean() < hi[1])]
    keep = [helmet] + (outer if name == 'malware' else [])
    every = np.concatenate(keep)
    mid = (every.min(0) + every.max(0)) / 2
    k = 2 / np.ptp(every[:, 1]) if name == 'malware' else 2 / (hi[1] - lo[1])
    mid = mid if name == 'malware' else (lo + hi) / 2
    return [(p - mid) * k for p in keep]


def inside(polys, x, z):
    hit = np.zeros(x.shape, dtype=bool)
    for p in polys:
        odd = np.zeros(x.shape, dtype=bool)
        for (ax, az), (bx, bz) in zip(p, np.roll(p, -1, 0)):
            odd ^= ((az > z) != (bz > z)) & (x < ax + (z - az) * (bx - ax) / ((bz - az) or 1e-12))
        hit |= odd
    return hit


def tree(objs, part=None):
    verts, tris = [], []
    for o in objs:
        me = o.data
        names = [s.material.name.split('.')[0] if s.material else '' for s in o.material_slots]
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        me.calc_loop_triangles()
        tris += [[base + i for i in t.vertices] for t in me.loop_triangles if part is None or (names and names[t.material_index] == part)]
    used = sorted({i for t in tris for i in t})
    return (BVHTree.FromPolygons(verts, tris), [verts[i] for i in used]) if tris else (None, [])


def calm(objs):
    """How much of the metal is calm, seen from the front through its own normals, baked map included: the share of a
    256 px picture where the surface turns under 3 degrees across 2 px. Broad planes raise it; rims and ribs lower it."""
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 4
    s.cycles.use_denoising = False
    s.render.resolution_x = s.render.resolution_y = 256
    s.render.film_transparent = True
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.image_settings.color_depth = '16'
    s.view_settings.view_transform = 'Standard'
    saved = []
    for o in objs:
        for slot in o.material_slots:
            nt = slot.material.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            saved.append((nt, out, out.inputs['Surface'].links[0].from_socket))
            nm = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None)
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            add = nt.nodes.new('ShaderNodeVectorMath')
            add.operation = 'MULTIPLY_ADD'
            add.inputs[1].default_value = (0.5, 0.5, 0.5)
            add.inputs[2].default_value = (0.5, 0.5, 0.5)
            nt.links.new(nm.outputs['Normal'] if nm else geo.outputs['Normal'], add.inputs[0])
            em = nt.nodes.new('ShaderNodeEmission')
            nt.links.new(add.outputs[0], em.inputs['Color'])
            # Only the metal is judged: the gold wire, the dark floors and the ember drop out of the picture.
            part = slot.material.name.split('.')[0]
            nt.links.new((nt.nodes.new('ShaderNodeBsdfTransparent') if part in PARTS else em).outputs[0], out.inputs['Surface'])
    bpy.ops.object.camera_add(location=(0, -9, 0), rotation=(math.radians(90), 0, 0))
    cam = bpy.context.view_layer.objects.active
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 3.2
    s.camera = cam
    path = os.path.join(OUT, '_normals.png')
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    px = np.array(img.pixels[:], dtype=np.float32).reshape(256, 256, 4)
    bpy.data.images.remove(img)
    os.remove(path)
    for nt, out, sock in saved:
        nt.links.new(sock, out.inputs['Surface'])
    bpy.data.objects.remove(cam)
    n = px[:, :, :3] * 2 - 1
    n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
    solid = px[:, :, 3] > 0.99
    for _ in range(3):
        solid[1:-1, 1:-1] &= solid[:-2, 1:-1] & solid[2:, 1:-1] & solid[1:-1, :-2] & solid[1:-1, 2:]
    turn = np.degrees(np.arccos(np.clip(np.sum(n[:, :-2] * n[:, 2:], 2), -1, 1)))
    turn = np.maximum(turn[:-2], np.degrees(np.arccos(np.clip(np.sum(n[:-2] * n[2:], 2), -1, 1)))[:, :-2])
    ok = solid[:-2, :-2] & solid[2:, :-2] & solid[:-2, 2:]
    return round(float(np.mean(turn[ok] < 3)), 3)


def form(objs, name):
    """What the eye would object to, in numbers; returns (metrics, errors)."""
    errors = []
    m = {}
    names = {s.material.name.split('.')[0] for o in objs for s in o.material_slots if s.material}
    missing = {'body', 'trim', 'liner', 'ember'} - names
    if missing:
        errors.append(f"no {', '.join(sorted(missing))}: not the modelled mask")
    whole, verts = tree(objs)
    body, _ = tree(objs, 'body') if 'body' in names else (whole, None)
    # The front view against the drawing.
    polys = FORM_DRAWING[name]
    g = np.linspace(-1.5, 1.5, 180)
    x, z = np.meshgrid(g, g)
    # The virus mask's stalks and spores stand outside the drawing's helmet by design.
    zone = np.hypot(x / 0.95, z / 1.15) < 1.02 if name == 'virus' else np.ones(x.shape, dtype=bool)
    solid = np.array([whole.ray_cast(Vector((a, -6, b)), Vector((0, 1, 0)), 12)[0] is not None for a, b in zip(x.ravel(), z.ravel())]).reshape(x.shape) & zone
    drawn = inside(polys, x, z) & zone
    m['front_overlap'] = round(float((solid & drawn).sum() / max(1, (solid | drawn).sum())), 3)
    if m['front_overlap'] < MIN_OVERLAP:
        errors.append(f"the front view is not the drawing: overlap {m['front_overlap']}, under {MIN_OVERLAP}")
    # The eyes: back in the head, and out of sight from the side.
    if 'ember' not in missing:
        _, ember = tree(objs, 'ember')
        e = np.array([v[:] for v in ember])
        side = np.sign(e[:, 0]) if abs(e[:, 0].mean()) < 0.1 else np.ones(len(e))
        v = np.array([q[:] for q in tree(objs, 'body')[1]])
        near = (np.abs(np.abs(v[:, 0]) - np.abs(e[:, 0]).mean()) < 0.25) & (np.abs(v[:, 2] - e[:, 2].mean()) < 0.32)
        m['eye_recess'] = round(float(e[:, 1].min() - v[near, 1].min()), 3)
        if m['eye_recess'] < MIN_RECESS:
            errors.append(f"the eyes sit only {m['eye_recess']} behind the brow, under {MIN_RECESS}")
        look = [Vector((math.sin(math.radians(70)) * d, -math.cos(math.radians(70)), 0)) for d in (1, -1)]
        hid = [body.ray_cast(Vector(p) + d * 0.01, d, 3)[0] is not None for p, sd in zip(e[::3], side[::3]) for d in look if d.x * sd < 0]
        m['eye_hidden'] = round(float(np.mean(hid)), 3)
        if m['eye_hidden'] < MIN_HIDDEN:
            errors.append(f"the socket hides only {m['eye_hidden']} of the eye from the side, under {MIN_HIDDEN}")
    if name == 'malware':
        # Across the middle of a drawn horn.
        cx, cz = polys[1].mean(0)
        row = np.linspace(cx - 0.5, cx + 0.5, 200)
        across = row[inside(polys[1:], row, np.full(200, cz))]
        depth = []
        for x in across:
            near = whole.ray_cast(Vector((x, -6, cz)), Vector((0, 1, 0)), 12)[0]
            far = whole.ray_cast(Vector((x, 6, cz)), Vector((0, -1, 0)), 12)[0]
            depth.append(far.y - near.y if near and far else 0)
        # A round horn is deep in the middle and thin at its sides; a cut-out wedge is the same thin plate all the way.
        m['horn_round'] = round(float(np.ptp(depth) / max(depth)), 3) if depth else 0
        if m['horn_round'] < MIN_HORN_ROUND:
            errors.append(f"the horns are flat wedges: {m['horn_round']}, under {MIN_HORN_ROUND}")
    m['calm'] = calm(objs)
    if m['calm'] < MIN_CALM:
        errors.append(f"the surface is a tangle: only {m['calm']} of it is calm, under {MIN_CALM}")
    return m, errors


def studio():
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = SAMPLES
    s.cycles.use_denoising = True
    s.render.resolution_x = s.render.resolution_y = SIZE
    s.render.film_transparent = True
    s.view_settings.view_transform = 'AgX'
    s.render.image_settings.color_depth = '8'
    world = bpy.data.worlds.new('w')
    s.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.018, 0.015, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1
    for name, loc, size, energy in (('key', (-2.6, -3.4, 3.0), 2.4, 450), ('rim', (3.2, 2.0, 1.2), 3.0, 300),
                                     ('fill', (3.0, -3.0, -0.6), 2.0, 60), ('top', (0, 0.4, 3.6), 3.0, 130)):
        bpy.ops.object.light_add(type='AREA', location=loc)
        lamp = bpy.context.view_layer.objects.active
        lamp.name = name
        lamp.data.size = size
        lamp.data.energy = energy
        lamp.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def finish(objs, look):
    """The model's own maps (normal, occlusion) under one of the site's finishes, the gold and the liner as on the site,
    the ember lit in onyx."""
    for o in objs:
        if not o.material_slots:
            o.data.materials.append(bpy.data.materials.new('body'))
        for slot in o.material_slots:
            mat = slot.material
            b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat and mat.node_tree else None
            if not b:
                continue
            for l in list(b.inputs['Base Color'].links):
                mat.node_tree.links.remove(l)
            part = mat.name.split('.')[0]
            base, metal, rough, coat = PARTS.get(part, FINISHES[look])
            b.inputs['Base Color'].default_value = (*base, 1)
            b.inputs['Metallic'].default_value = metal
            b.inputs['Roughness'].default_value = rough
            b.inputs['Coat Weight'].default_value = coat
            if part == 'ember':
                b.inputs['Emission Color'].default_value = (1.0, 0.34, 0.02, 1)
                b.inputs['Emission Strength'].default_value = 1.1 if look == 'onyx' else 0


def on_pages(path):
    """One render with no background becomes two pictures: the mask on a dark page and on a light one."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    out = []
    for page, colour in PAGES.items():
        a = px[:, :, 3:]
        rgb = px[:, :, :3] * a + np.array(colour, dtype=np.float32) ** 2.2 * (1 - a)
        pic = bpy.data.images.new('page', w, h, alpha=False)
        pic.colorspace_settings.name = 'sRGB'
        pic.pixels[:] = np.concatenate([rgb, np.ones_like(a)], 2).ravel()
        dest = path.replace('.png', f'-{page}.png')
        pic.filepath_raw = dest
        pic.file_format = 'PNG'
        pic.save()
        bpy.data.images.remove(pic)
        out.append(os.path.basename(dest))
    os.remove(path)
    return out


def shoot(objs, name, wire):
    lo = Vector((min((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box),
                 min((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box),
                 min((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)))
    hi = Vector((max((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box),
                 max((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box),
                 max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)))
    mid = (lo + hi) / 2
    span = max(hi - lo)
    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    bpy.context.scene.camera = cam
    cam.data.lens = 85
    s = bpy.context.scene
    # The model faces -Y (glTF's +Z, toward the viewer, imported into Blender's Z-up).
    views = {
        'front': (mid + Vector((0, -span * 2.8, 0)), mid, 85),
        'turn': (mid + Vector((span * 1.6, -span * 2.2, span * 0.45)), mid, 85),
        'eyes': (mid + Vector((span * 0.6, -span * 1.6, span * 0.35)), mid + Vector((0, 0, span * 0.08)), 85),
    }
    shots = []
    for look in WORN.get(name, ('gold',)):
        finish(objs, look)
        for view, (loc, at, lens) in views.items():
            cam.location = loc
            cam.rotation_euler = (at - loc).to_track_quat('-Z', 'Y').to_euler()
            cam.data.lens = lens
            s.render.filepath = os.path.join(OUT, f'{name}-{look}-{view}.png')
            bpy.ops.render.render(write_still=True)
            shots += on_pages(s.render.filepath)
    if not wire:
        return shots
    # The triangles, drawn as thin dark lines over the metal.
    for o in objs:
        w = o.modifiers.new('wire', 'WIREFRAME')
        w.thickness = span * 0.0012
        w.use_replace = False
        w.material_offset = 1
        dark = bpy.data.materials.new('wire')
        dark.diffuse_color = (0, 0, 0, 1)
        dark.use_nodes = True
        dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1)
        o.data.materials.append(dark)
    cam.location = views['turn'][0]
    cam.rotation_euler = (views['turn'][1] - views['turn'][0]).to_track_quat('-Z', 'Y').to_euler()
    s.render.filepath = os.path.join(OUT, f'{name}-wire.png')
    bpy.ops.render.render(write_still=True)
    shots.append(os.path.basename(s.render.filepath))
    return shots


os.makedirs(OUT, exist_ok=True)
report = {}
failed = False
FORM_DRAWING = {}
for path in FILES:
    clean()
    name = os.path.splitext(os.path.basename(path))[0]
    FORM_DRAWING[name] = drawing(name)
    clean()
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    metrics, errors = check(objs)
    metrics['bytes'] = os.path.getsize(path)
    shape, wrong = form(objs, name)
    metrics.update(shape)
    errors += wrong
    studio()
    finish(objs, WORN.get(name, ('gold',))[0])
    metrics['pictures'] = [] if os.environ.get('MASK_QA_NO_PICTURES') else shoot(objs, name, True)
    report[name] = {'pass': not errors, 'errors': errors, **metrics}
    failed = failed or bool(errors)
    print(f"{name}: {'pass' if not errors else 'FAIL'} {metrics['tris']} triangles, {metrics['bytes']} bytes, " +
          ', '.join(f'{k} {metrics[k]}' for k in ('front_overlap', 'eye_recess', 'eye_hidden', 'horn_round', 'calm') if k in metrics) +
          ''.join(f'\n  {e}' for e in errors))
with open(os.path.join(OUT, 'report.json'), 'w') as f:
    json.dump(report, f, indent=2)
sys.exit(1 if failed else 0)
