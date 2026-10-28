"""
The quality gate for the site's 3D masks (web/assets/models/*.glb), run by Blender with no window:

    blender --background --factory-startup --python scripts/blender/mask_qa.py -- <out-dir> <model.glb> [...]

For each model it imports the file as the site receives it, checks it with numbers and draws it, so a change to the
masks is judged on both:

  checks   closed and manifold (no holes, no edge shared by three faces), every face pointing outward, no collapsed
           faces, a UV map inside the unit square, a normal map and an occlusion map of sensible size, a triangle
           budget. The checks follow the asset QA gate of the blender-agent-skills (blender-asset-qa).
  pictures <name>-front.png, <name>-turn.png (three-quarter), <name>-eyes.png (close-up of the eyes, where a coarse
           model shows its facets first) and <name>-wire.png (the triangles), in a plain gold studio.

Writes <out-dir>/report.json and exits with status 1 when any model fails a check.
"""
import json
import math
import os
import sys
from collections import Counter

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT, FILES = argv[0], argv[1:]
MAX_TRIS = 24000          # all meshes of one mask together
MAX_TEXTURE = 2048        # pixels on a side
SIZE = int(os.environ.get('MASK_QA_SIZE', '640'))
SAMPLES = int(os.environ.get('MASK_QA_SAMPLES', '24'))


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
        for p in me.polygons:
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


def studio():
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = SAMPLES
    s.cycles.use_denoising = True
    s.render.resolution_x = s.render.resolution_y = SIZE
    s.render.film_transparent = False
    s.view_settings.view_transform = 'AgX'
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


def gold(objs):
    """The model's own maps (normal, occlusion) under a polished gold finish, as the site shows it."""
    for o in objs:
        if not o.material_slots:
            o.data.materials.append(bpy.data.materials.new('gold'))
        for slot in o.material_slots:
            mat = slot.material
            if mat and not mat.node_tree:
                mat.use_nodes = True
            if not mat or not mat.node_tree:
                continue
            b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not b:
                continue
            for l in list(b.inputs['Base Color'].links):
                mat.node_tree.links.remove(l)
            b.inputs['Base Color'].default_value = (0.95, 0.68, 0.3, 1)
            b.inputs['Metallic'].default_value = 1.0
            b.inputs['Roughness'].default_value = 0.2


def shoot(objs, name):
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
        'front': (mid + Vector((0, -span * 3.6, 0)), mid, 85),
        'turn': (mid + Vector((span * 2.2, -span * 2.8, span * 0.6)), mid, 85),
        'eyes': (mid + Vector((span * 0.6, -span * 1.6, span * 0.35)), mid + Vector((0, 0, span * 0.08)), 85),
    }
    shots = []
    for view, (loc, at, lens) in views.items():
        cam.location = loc
        cam.rotation_euler = (at - loc).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        s.render.filepath = os.path.join(OUT, f'{name}-{view}.png')
        bpy.ops.render.render(write_still=True)
        shots.append(os.path.basename(s.render.filepath))
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
for path in FILES:
    clean()
    name = os.path.splitext(os.path.basename(path))[0]
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    metrics, errors = check(objs)
    metrics['bytes'] = os.path.getsize(path)
    studio()
    gold(objs)
    metrics['pictures'] = [] if os.environ.get('MASK_QA_NO_PICTURES') else shoot(objs, name)
    report[name] = {'pass': not errors, 'errors': errors, **metrics}
    failed = failed or bool(errors)
    print(f"{name}: {'pass' if not errors else 'FAIL'} {metrics['tris']} triangles, {metrics['bytes']} bytes" + ''.join(f'\n  {e}' for e in errors))
with open(os.path.join(OUT, 'report.json'), 'w') as f:
    json.dump(report, f, indent=2)
sys.exit(1 if failed else 0)
