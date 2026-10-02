"""Рендер «архитектурного макета» для титульного слайда: белый город из OSM, ЖК поэтажно, колбы нагрузки.

Запуск (Blender 4.x/5.x, без интерфейса):
  blender -b -P scripts/render_hero.py -- public/data/kazan.json docs/hero.png
Данные — та же выгрузка района, что и в приложении; цвета колб — состояние «с ЖК», 2031 г.
"""
import json, math, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['public/data/kazan.json', 'docs/hero.png']
SRC, OUT = str(Path(args[0]).resolve()), str(Path(args[1]).resolve())
LON0, LAT0 = 49.229, 55.76  # участок ЖК-1
KX, KY = 62600.0, 111200.0
R = 750  # радиус сцены, м

def xy(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)

d = json.load(open(SRC, encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.6, alpha=1.0, emit=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    if transmission:
        bsdf.inputs['Transmission Weight'].default_value = transmission
        bsdf.inputs['IOR'].default_value = 1.2
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    return m

def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB → линейный

M_CITY = mat('city', hexrgb('#f6f5f1'), 0.55)
M_GROUND = mat('ground', hexrgb('#dfe3e6'), 0.9)
M_ROAD = mat('road', hexrgb('#f9fafb'), 0.8)
M_P1 = mat('phase1', hexrgb('#1f4fd8'), 0.35)
M_P2 = mat('phase2', hexrgb('#4f7cf0'), 0.35)
M_SITE = mat('site', hexrgb('#c9d6f7'), 0.8)
M_GLASS = mat('glass', (0.95, 0.97, 1.0), 0.03, transmission=1.0)
STATUS = {'crit': mat('crit', hexrgb('#d2452f'), 0.4, emit=0.4), 'warn': mat('warn', hexrgb('#e3a21a'), 0.4, emit=0.3),
          'ok': mat('ok', hexrgb('#3a9d6e'), 0.4, emit=0.3), 'uncertain': mat('unc', hexrgb('#8c7ae6'), 0.4, emit=0.3)}

def extrude_obj(name, polys, material, flat=False):
    """polys: [(ring_xy, base, top)] → один объект (быстрее тысяч отдельных)."""
    bm = bmesh.new()
    for ring, base, top in polys:
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        verts = [bm.verts.new((q[0], q[1], q[2] if len(q) > 2 else base)) for q in ring]
        try:
            f = bm.faces.new(verts)
        except ValueError:
            continue
        if f.normal.z < 0:
            f.normal_flip()
        if flat:
            continue
        r = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, verts=[v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, top - base))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    scene.collection.objects.link(ob)
    return ob

# город
city = []
for kind, h, _flats, ring in d['buildings']:
    pts = [xy(p) for p in ring]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    if math.hypot(cx, cy) < R and not (abs(cx) < 175 and abs(cy) < 125):
        city.append((pts, 0, max(3, h)))
extrude_obj('city', city, M_CITY)

# дороги — плоские полосы
roads = []
wcls = {'motorway': 24, 'trunk': 24, 'primary': 22, 'secondary': 16, 'tertiary': 11}
for cls, _name, _lanes, line in d['roads']:
    w = wcls.get(cls, 7)
    pts = [xy(p) for p in line]
    for a, b in zip(pts, pts[1:]):
        if math.hypot(*a) > R + 100 and math.hypot(*b) > R + 100:
            continue
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * w / 2, dx / L * w / 2
        z = 0.35 + w / 200 + (len(roads) % 40) * 0.01  # разная высота: совпадающие грани дают в Cycles чёрные пятна
        roads.append(([(a[0] + nx, a[1] + ny, z), (b[0] + nx, b[1] + ny, z), (b[0] - nx, b[1] - ny, z), (a[0] - nx, a[1] - ny, z)], 0, 0))
extrude_obj('roads', roads, M_ROAD, flat=True)

bpy.ops.mesh.primitive_circle_add(vertices=128, radius=6000, fill_type='NGON', location=(0, 0, -0.05))
bpy.context.object.data.materials.append(M_GROUND)

# ЖК-1: участок и корпуса поэтажно (как в src/data/synthetic.ts); вторая очередь достроена наполовину
def rect(cx, cy, w, h):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
extrude_obj('site', [(rect(0, 0, 330, 230), 0, 0.3)], M_SITE)
for (cx, cy, floors, phase) in [(-100, 70, 25, 0), (0, 70, 21, 0), (100, 70, 17, 0), (-100, -45, 17, 1), (0, -45, 21, 1), (100, -45, 25, 1)]:
    built = floors if phase == 0 else int(floors * 0.6)
    extrude_obj(f'zhk{cx}{cy}', [(rect(cx, cy, 78, 17), i * 3, i * 3 + 2.6) for i in range(built)], M_P1 if phase == 0 else M_P2)

# колбы: высота 70 м = 100% мощности, заливка — загрузка (состояние «с ЖК», 2031)
H = 70
def column(c, ratio, status, r=15):
    x, y = xy(c)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=H, location=(x, y, H / 2))
    bpy.context.object.data.materials.append(M_GLASS)
    hh = min(ratio, 2.2) * H
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r * 0.86, depth=hh, location=(x, y, hh / 2))
    bpy.context.object.data.materials.append(STATUS[status])
by = {o['id']: o for o in d['objects']}
for oid, ratio, st in [('kg163', 2.2, 'crit'), ('sc149', 1.6, 'uncertain')]:
    if oid in by:
        column(by[oid]['coords'], ratio, st)
for o in d['objects']:
    if o['kind'] == 'intersection':
        x, y = xy(o['coords'])
        if math.hypot(x, y) < 700:
            z = o['load'] / o['capacity'] * (1.4 if math.hypot(x, y) < 450 else 1.0)
            column(o['coords'], z, 'crit' if z >= 1 else 'warn' if z >= 0.7 else 'ok', r=9)

# свет, камера, рендер
world = bpy.data.worlds.new('w'); scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (*hexrgb('#dfe3e6'), 1)  # как земля — горизонт растворяется
bg.inputs['Strength'].default_value = 0.9
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(-40)))
sun = bpy.context.object.data; sun.energy = 3.2; sun.angle = math.radians(6)

cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 38; cam_data.clip_end = 10000  # по умолчанию 1 км — дальний план обрезается
cam_data.dof.use_dof = True; cam_data.dof.aperture_fstop = 0.35  # tilt-shift: макет выглядит миниатюрой
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
cam.location = (820, -1050, 720)
target = Vector((-60, -80, 30))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.dof.focus_distance = (target - cam.location).length
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('HERO', OUT, len(city), 'зданий')
