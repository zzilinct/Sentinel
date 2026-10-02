"""
Sentinel's three masks as studio product renders, built in Blender from the same drawings as the icons.

    python scripts/blender/masks.py --svg-dir <dir> --out <dir> [--mask scam|virus|malware|glass|pearl|onyx|all]
                                    [--tint yellow|orange|red] [--pose stand|lay] [--frames N] [--size PX] [--samples N]

The site uses: each of scam, virus and malware with --tint yellow, orange and red (the severity colours), and
--mask onyx --pose lay --yaw 16 for the hero. The renders are cropped and saved as web/assets/img/masks/*.webp.

Needs the Blender Python module (pip install bpy). The SVGs are the GLYPHS of web/assets/js/masks.js written
as files (scripts/blender/export-svgs.js does that). Each mask is extruded, remeshed so its edges round like
cast metal, curved like a face and lit as a product shot: softboxes for reflections, a warm key and coloured
rims, on a transparent background so the site can place it over anything.

--frames N renders a turntable of N frames (one full turn) for scroll-scrubbed rotation; otherwise one still.
"""
import argparse
import math
import os
import sys

import bpy
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
ap.add_argument('--tint', default='', choices=['', 'yellow', 'orange', 'red'], help='recolour the mask in a severity colour')
ap.add_argument('--pose', default='stand', choices=['stand', 'lay'], help='lay: tipped back and turned, lying on a surface')
ap.add_argument('--glb', action='store_true', help='export the mask as a glTF model (no render) for the site to light in real time')
ap.add_argument('--faces', type=int, default=36000, help='--glb: the model is simplified to about this many faces')
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
    'onyx': dict(svg='scam', base=(0.008, 0.007, 0.006), metal=0.0, rough=0.25, coat=0.6, rim=(1.0, 0.66, 0.26), world=0.05, key=0.35),
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


def import_svg(name):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=os.path.join(args.svg_dir, f'{name}.svg'))
    return [o for o in bpy.data.objects if o not in before and o.type == 'CURVE']


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def build(look):
    curves = import_svg(look['svg'])
    # The helmet is drawn 11.6..49.4 on the 64 grid, centred on (32, 30.5); every mask uses the same scale so the
    # three faces match. Imported SVG units are tiny, so measure the helmet path's own bounds.
    lo, hi = bounds(curves)
    spores = []
    if look['svg'] == 'virus':
        # The spores are the path with many small closed splines; turn them into beads.
        spore_obj = max(curves, key=lambda o: len(o.data.splines))
        for sp in spore_obj.data.splines:
            pts = [spore_obj.matrix_world @ Vector(p.co) for p in sp.bezier_points] or [spore_obj.matrix_world @ Vector(p.co[:3]) for p in sp.points]
            c = sum(pts, Vector()) / len(pts)
            spores.append(('spore', c))
        curves = [o for o in curves if o is not spore_obj]
        bpy.data.objects.remove(spore_obj)
        lo, hi = bounds(curves)
    if look['svg'] == 'scam':
        # The rivet becomes a domed stud rather than a flat disc.
        rivet = min(curves, key=lambda o: (o.dimensions.x * o.dimensions.y) or 1e9)
        rlo, rhi = bounds([rivet])
        spores.append(('rivet', (rlo + rhi) / 2))
        curves = [o for o in curves if o is not rivet]
        bpy.data.objects.remove(rivet)
    for o in curves:
        o.data.dimensions = '2D'
        o.data.fill_mode = 'BOTH'
        o.data.resolution_u = 32
        o.data.extrude = 0.0
    # Convert each drawing on its own, so one shape's outline never cuts a hole in another (the rivet), then join.
    select_only(curves)
    bpy.ops.object.convert(target='MESH')
    # Small details (the rivet) stand proud of the face instead of melting into it.
    biggest = max(curves, key=lambda o: len(o.data.vertices))
    for o in curves:
        if o is not biggest and look['svg'] != 'malware':
            for v in o.data.vertices:
                v.co.z -= 0.0012 / max(1e-9, o.scale.x)
    select_only(curves)
    if len(curves) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.data.materials.clear()
    lo, hi = bounds([obj])
    unit = 2.0 / (hi.y - lo.y)  # the drawing becomes 2 m tall
    # Centre and scale: the drawing's height becomes 2.
    mid = (lo + hi) / 2
    for v in obj.data.vertices:
        v.co = (obj.matrix_world @ v.co - mid) * unit
    obj.matrix_world = obj.matrix_world.__class__.Identity(4)
    spores = [(k, (c - mid) * unit) for k, c in spores]

    # Thickness, then a voxel remesh so every edge rounds like cast metal.
    solid = obj.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = 0.26
    solid.offset = 0
    bpy.ops.object.modifier_apply(modifier='solid')
    rem = obj.modifiers.new('remesh', 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = 0.012
    bpy.ops.object.modifier_apply(modifier='remesh')
    sm = obj.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 6
    sm.smooth_type = 'LENGTH_WEIGHTED'
    bpy.ops.object.modifier_apply(modifier='smooth')

    # Stand it up facing the camera (-Y) and curve it like a face: the middle forward, the sides back.
    for v in obj.data.vertices:
        x, y, z = v.co
        v.co = Vector((x, z - 0.6 * (1 - min(1.8, (x * x) / 0.5)) - 0.14 * (1 - min(1.8, (y * y) / 0.9)), y))
    bpy.ops.object.shade_smooth()

    beads = []
    for kind, c in spores:
        if kind == 'rivet':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.09, location=(c.x, -0.5, c.y))
            bpy.context.view_layer.objects.active.scale = (1, 0.55, 1)
        else:
            # Pulled in close around the helmet, where they orbit on the site.
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.12, location=(c.x * 0.66, -0.2, c.y * 0.66))
        bpy.ops.object.shade_smooth()
        beads.append(bpy.context.view_layer.objects.active)

    mat = material(look)
    for o in [obj, *beads]:
        o.data.materials.append(mat)
    rig = bpy.data.objects.new('rig', None)
    bpy.context.scene.collection.objects.link(rig)
    for o in [obj, *beads]:
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
    softbox('rimL', (-3.2, 2.2, 0.6), (0.6, 3.0), 650, rim)
    softbox('rimR', (3.2, 2.0, 1.2), (0.6, 3.0), 520, rim)
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
    look = {**LOOKS[kind], **TINTS[args.tint]} if args.tint else LOOKS[kind]
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
        rig.rotation_euler = (math.radians(-24), math.radians(28), math.radians(args.yaw)) if args.pose == 'lay' else (0, 0, math.radians(args.yaw))
        name = kind + ('-lay' if args.pose == 'lay' else '') + (f'-{args.tint}' if args.tint else '')
        s.render.filepath = os.path.join(args.out, f'{name}.png')
        bpy.ops.render.render(write_still=True)


def export_glb(kind):
    """The mask as geometry only: the site gives it its metal, its light and its pose (web/assets/js/mask3d.js)."""
    reset()
    rig = build(LOOKS[kind])
    meshes = [o for o in rig.children if o.type == 'MESH']
    face = max(meshes, key=lambda o: len(o.data.polygons))
    if len(face.data.polygons) > args.faces:
        dec = face.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = args.faces / len(face.data.polygons)
        select_only([face])
        bpy.ops.object.modifier_apply(modifier='decimate')
    for o in meshes:
        o.data.materials.clear()
        o.name = 'face' if o is face else 'bead'
    select_only([rig, *meshes])
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f'{LOOKS[kind]["svg"]}.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_materials='NONE', export_yup=True, export_texcoords=False)


for kind in (LOOKS if args.mask == 'all' else [args.mask]):
    if args.glb:
        export_glb(kind)
    else:
        render(kind)
