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
from mathutils import Vector
from mathutils.kdtree import KDTree

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
ap.add_argument('--faces', type=int, default=16000, help='--glb: the low model has about this many triangles')
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


THICK = 0.2   # the shell's thickness, on a mask 2 tall


def relief(obj, outline):
    """Cast detail on the front of the flat shell, measured from the drawing's outlines (d, distance to the nearest
    edge or eye): a raised lip that frames every edge and eye like a bezel, an engraved line inside it, the middle
    swelling gently like a face, and a ridge down the centre. The silhouette is untouched, so the mask is still the
    icon from the front."""
    bump = lambda d, c, w: math.exp(-((d - c) / w) ** 2)
    smooth = lambda a, b, d: 0.0 if d <= a else 1.0 if d >= b else ((d - a) / (b - a)) ** 2 * (3 - 2 * (d - a) / (b - a))
    # Normals first: reading one after a vertex has moved makes Blender work them all out again.
    normals = [v.normal.z for v in obj.data.vertices]
    for v, nz in zip(obj.data.vertices, normals):
        if v.co.z > -THICK * 0.2:
            continue
        facing = max(0.0, -nz)
        if facing < 0.05:
            continue
        d = outline.find(Vector((v.co.x, v.co.y, 0)))[2]
        h = (0.028 * bump(d, 0.075, 0.03)
             - 0.012 * bump(d, 0.145, 0.013)
             + 0.04 * smooth(0.17, 0.6, d)
             + 0.022 * bump(v.co.x, 0.0, 0.045) * smooth(0.16, 0.3, d))
        v.co.z -= h * facing


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

    # Every outline of the drawing (the outside and each eye), sampled finely: the relief below is measured from it.
    edge_pts = []
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].co, e.verts[1].co
            steps = max(1, int((b - a).length / 0.004))
            edge_pts += [a.lerp(b, i / steps) for i in range(steps + 1)]
    bm.free()
    outline = KDTree(len(edge_pts))
    for i, p in enumerate(edge_pts):
        outline.insert(Vector((p.x, p.y, 0)), i)
    outline.balance()

    # Thickness, then a voxel remesh so every edge rounds like cast metal. Thinner than a plate (a mask is a shell),
    # and fine enough to carry the relief.
    solid = obj.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = THICK
    solid.offset = 0
    bpy.ops.object.modifier_apply(modifier='solid')
    rem = obj.modifiers.new('remesh', 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = args.voxel
    bpy.ops.object.modifier_apply(modifier='remesh')
    sm = obj.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 6
    sm.smooth_type = 'LENGTH_WEIGHTED'
    bpy.ops.object.modifier_apply(modifier='smooth')
    relief(obj, outline)

    # Stand it up facing the camera (-Y) and curve it like a face: the middle forward, the sides back.
    for v in obj.data.vertices:
        x, y, z = v.co
        v.co = Vector((x, z - 0.6 * (1 - min(1.8, (x * x) / 0.5)) - 0.14 * (1 - min(1.8, (y * y) / 0.9)), y))
    bpy.ops.object.shade_smooth()

    beads = []
    for kind, c in spores:
        if kind == 'rivet':
            # Seated on the metal where it is (the relief moved the surface): found by looking straight at the face.
            hit, loc, _n, _i = obj.ray_cast(Vector((c.x, -5, c.y)), Vector((0, 1, 0)))
            y = (loc.y - 0.01) if hit else -0.5
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.09, location=(c.x, y, c.y))
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


def bake_image(name, colour, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def export_glb(kind):
    """The mask for the site, made as game artists make a hero prop (blender-texture-baking, high to low): the detailed
    model from build() is the high one; a simplified copy with a UV map is the low one, and the high one's shape is
    baked onto it as a normal map and an occlusion map. The site gives it its metal, light and pose
    (web/assets/js/mask3d.js); the file carries only the shape and those two maps."""
    s = reset()
    rig = build(LOOKS[kind])
    meshes = [o for o in rig.children if o.type == 'MESH']
    for o in meshes:
        o.parent = None
        o.matrix_world = o.matrix_world.copy()
    # build() stands the mask up by swapping two axes, which mirrors it and turns every face inside out. Cycles
    # shades both sides alike, but a real-time renderer culls the faces it thinks point away. Point them outward.
    select_only(meshes)
    bpy.ops.object.join()
    high = bpy.context.view_layer.objects.active
    high.name = 'high'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # The low model: the same surface, simplified, with UVs (blender-retopology-uv). Collapse decimation keeps the
    # silhouette where it matters; the normal map carries everything smaller than a triangle.
    low = high.copy()
    low.data = high.data.copy()
    low.name = 'mask'
    bpy.context.scene.collection.objects.link(low)
    tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
    if tris > args.faces:
        dec = low.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = args.faces / tris
        dec.use_collapse_triangulate = True
        select_only([low])
        bpy.ops.object.modifier_apply(modifier='decimate')
    select_only([low])
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake (blender-texture-baking): rays leave a little outside the low surface and land on the high one.
    s.render.bake.use_selected_to_active = True
    s.render.bake.cage_extrusion = 0.03
    s.render.bake.max_ray_distance = 0.08
    s.render.bake.margin = 8
    s.render.bake.margin_type = 'EXTEND'
    mat = bpy.data.materials.new('mask')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.2
    bsdf.inputs['Metallic'].default_value = 1.0
    low.data.materials.clear()
    low.data.materials.append(mat)
    high.data.materials.clear()
    high.data.materials.append(bpy.data.materials.new('high'))
    maps = {}
    for kind_of, colour in (('NORMAL', False), ('AO', False)):
        # Occlusion changes slowly across the surface: half the size is plenty.
        img = bake_image(f'{LOOKS[kind]["svg"]}-{kind_of.lower()}', colour, args.maps if kind_of == 'NORMAL' else args.maps // 2)
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        nt.nodes.active = node
        # Both from the high model. The low one is invisible to every ray while baking: its own faces, just outside
        # the high surface, would otherwise shadow it in blotches.
        s.cycles.samples = 16 if kind_of == 'NORMAL' else 160
        for flag in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
            setattr(low, flag, False)
        select_only([high, low])
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind_of, normal_space='TANGENT')
        maps[kind_of] = node
    # Wired the way the glTF exporter reads them: the normal map through a Normal Map node, the occlusion through
    # its glTF Material Output group.
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(maps['NORMAL'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    group = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if not group.interface.items_tree:
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gnode = nt.nodes.new('ShaderNodeGroup')
    gnode.node_tree = group
    nt.links.new(maps['AO'].outputs['Color'], gnode.inputs['Occlusion'])

    select_only([low])
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f'{LOOKS[kind]["svg"]}.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_materials='EXPORT', export_yup=True, export_texcoords=True,
                              export_normals=True, export_tangents=False, export_image_format=args.image_format,
                              export_image_quality=args.image_quality)
    if args.keep_high:
        for node in maps.values():
            node.image.filepath_raw = os.path.join(args.out, f'{node.image.name}.png')
            node.image.file_format = 'PNG'
            node.image.save()
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
