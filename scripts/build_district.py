"""Сборка данных района из открытых источников в public/data/kazan.json.

Источники (все открытые, персональные данные не берутся):
  1. OpenStreetMap через Overpass API (© участники OpenStreetMap, ODbL) — здания, дороги,
     остановки, светофоры, магазины, аптеки, парковки, поликлиники, спорт, стройки метро.
  2. Реестр лицензий Рособрнадзора (выгрузка 25.08.2026, архив «БАЗА_ОБРАЗОВАТЕЛЬНЫХ_ОРГАНИЗАЦИЙ_РОССИИ»)
     — школы и детские сады: наименование, ИНН, адрес, координаты. ФИО, телефоны и почта отбрасываются.
  3. edu.tatar.ru, «Визитная карточка» организации — фактический контингент («У нас учатся: N»).

Открытого реестра проектной мощности школ и садов нет: у управления образования она есть по каждому зданию (доклад
мэрии 2021 г.: превышена в 125 зданиях школ), но набором не публикуется; в карточке edu.tatar.ru её нет, отдельные школы
пишут её в тексте сайта или в отчёте о самообследовании. Скрипт оценивает её по площади здания: Σ(площадь пятна × этажность) / удельная площадь на место.
Результат помечается статусом «оценка» с диапазоном и заменяется фактом при импорте данных ЦГТ.

Запуск (Python 3.10+, без сторонних библиотек):
  python scripts/build_district.py --cache C:/tmp/kzn --registry "<путь к БАЗА_...zip>"
Кэш: osm_*.json (Overpass), edu_kazan.json (выборка реестра по Казани), edu_tatar_contingent.json.
Отсутствующие файлы кэша скачиваются заново.
"""
import argparse, csv, html, io, json, math, re, time, urllib.parse, urllib.request, zipfile
from pathlib import Path

BBOXES = {  # юг, запад, север, восток
    'osm_azino.json': (55.725, 49.195, 55.775, 49.300),  # Советский район: Азино, Салмачи
    'osm_sw.json': (55.695, 49.130, 55.745, 49.230),  # Приволжский район: Гареева, Юбилейная
}
OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'  # overpass-api.de в 09.2026 отвечает 406
QUERY = """[out:json][timeout:120];
(
  way["building"]({b});
  relation["building"]({b});
  nwr["amenity"~"^(school|kindergarten|clinic|doctors|hospital|pharmacy|cafe|restaurant|fast_food)$"]({b});
  nwr["shop"]({b});
  node["highway"="bus_stop"]({b});
  node["public_transport"="platform"]({b});
  node["highway"="traffic_signals"]({b});
  nwr["amenity"="parking"]({b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({b});
  nwr["leisure"~"^(sports_centre|pitch|stadium|fitness_centre)$"]({b});
  way["landuse"="construction"]({b});
);
out body geom;"""
# вода, парки, лес и кладбища — подложка карты и запрет размещения новых объектов
GROUND_QUERY = """[out:json][timeout:120];
(
  way["natural"~"^(water|wetland)$"]({b});
  way["waterway"="riverbank"]({b});
  relation["natural"="water"]({b});
  way["leisure"~"^(park|garden)$"]({b});
  relation["leisure"="park"]({b});
  way["landuse"~"^(forest|cemetery)$"]({b});
);
out body geom;"""
UA = {'User-Agent': 'zastroyka-hackathon/1.0 (research; open data)'}

# Удельная общая площадь здания на одно место, м². Проектов повторного применения Минстроя (Татинвестгражданпроект):
# школа на 1224 места — 25 801,7 м² (21,1 м²/место); детский сад до 225 мест — 4 078,5 м² (18,1 м²/место).
# Нижняя граница — школа 1100 мест в Шатуре 16 841 м² (15,3) и сад 220 мест в Приволжском р-не Казани 3 738,7 м² (17,0);
# советские типовые здания компактнее, поэтому нижняя граница диапазона снижена до 12 и 11 (допущение).
# Советские типовые здания в 3–4 раза компактнее: школа 222-1-126 на 1176 мест — 5 451,8 м² (4,6 м²/место), 222-1-217пв —
# 7 844,4 м² (6,7); берём 5,5. Для садов советских паспортов не нашли — 8 м²/место (допущение). Эпоха здания в OSM почти
# не заполнена, поэтому мощность — диапазон [площадь / 21,1 … площадь / 5,5]; центральное значение — по калибровке на лицее
# — среднее по школам района с опубликованной мощностью: лицей № 186 (2 725 мест, «Реальное время» 03.04.2026; площадь OSM
# 43 200 м² → 15,9 м²/место) и лицей № 35 (1 000 мест, сайт лицея на edu.tatar.ru; 17 700 м² → 17,7) → 16,8 м²/место.
M2_PER_PLACE = {'school': (21.1, 5.5, 16.8), 'kindergarten': (18.1, 8.0, 15.9)}  # (макс. м²/место, мин., калибровка)
DEFAULT_LEVELS = {'apartments': 9, 'residential': 5, 'house': 2, 'detached': 2, 'semidetached_house': 2, 'terrace': 2,
                  'garages': 1, 'garage': 1, 'shed': 1, 'roof': 1, 'school': 3, 'kindergarten': 2, 'retail': 2,
                  'commercial': 3, 'office': 5, 'industrial': 2, 'warehouse': 1, 'service': 1}
DAILY_SHOPS = {'supermarket', 'convenience', 'greengrocer', 'bakery', 'butcher', 'dairy', 'deli', 'general', 'kiosk'}


def fetch(url, data=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            return urllib.request.urlopen(req, timeout=180).read()
        except Exception:
            time.sleep(3 * (i + 1))
    raise RuntimeError('не удалось скачать ' + url)


def load_osm(cache: Path, bboxes):
    elements = {}
    for name, (s, w, n, e) in bboxes.items():
        f = cache / name
        if not f.exists():
            q = QUERY.replace('{b}', f'{s},{w},{n},{e}')
            f.write_bytes(fetch(OVERPASS, urllib.parse.urlencode({'data': q}).encode()))
        for el in json.loads(f.read_text(encoding='utf-8'))['elements']:
            elements[(el['type'], el['id'])] = el
    return list(elements.values())


def load_ground(cache: Path, bboxes):
    elements = {}
    for name, (s, w, n, e) in bboxes.items():
        f = cache / ('ground_' + name.replace('osm_', ''))
        if not f.exists():
            q = GROUND_QUERY.replace('{b}', f'{s},{w},{n},{e}')
            f.write_bytes(fetch(OVERPASS, urllib.parse.urlencode({'data': q}).encode()))
        for el in json.loads(f.read_text(encoding='utf-8'))['elements']:
            elements[(el['type'], el['id'])] = el
    return list(elements.values())


def stitch(ways):
    """Внешние участники мультиполигона — незамкнутые линии; склеиваем по совпадающим концам в кольца."""
    ways = [list(w) for w in ways if len(w) > 1]
    rings = []
    while ways:
        cur = ways.pop()
        while cur[0] != cur[-1]:
            for i, w in enumerate(ways):
                if w[0] == cur[-1]: cur += w[1:]
                elif w[-1] == cur[-1]: cur += w[::-1][1:]
                elif w[-1] == cur[0]: cur = w[:-1] + cur
                elif w[0] == cur[0]: cur = w[::-1][:-1] + cur
                else: continue
                ways.pop(i)
                break
            else:
                break  # кольцо не замкнулось (участник за пределами выгрузки) — отбрасываем
        if cur[0] == cur[-1] and len(cur) > 3:
            rings.append(cur)
    return rings


def load_registry(cache: Path, zip_path: str | None):
    f = cache / 'edu_kazan.json'
    if not f.exists():
        z = zipfile.ZipFile(zip_path)
        root = 'БАЗА_ОБРАЗОВАТЕЛЬНЫХ_ОРГАНИЗАЦИЙ_РОССИИ/'
        out = {}
        for kind, name in [('school', '2_Школы/Школы_России.csv'), ('kindergarten', '3_Детские_сады/Детские_сады_России.csv')]:
            with z.open(root + name) as fh:
                rows = csv.DictReader(io.TextIOWrapper(fh, encoding='utf-8-sig'), delimiter=';')
                out[kind] = [r for r in rows if r['Населённый пункт'] == 'Казань' and 'Татарстан' in r['Субъект РФ']]
        f.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    reg = json.loads(f.read_text(encoding='utf-8'))
    keep = ['ИНН', 'Краткое наименование', 'Адрес', 'Широта', 'Долгота', 'Ссылка на лицензию', 'Форма']  # без ПДн
    return {k: [{c: r[c] for c in keep} for r in rows] for k, rows in reg.items()}


def load_contingent(cache: Path, districts=('sovetcki', 'priv')):
    # кэш Азино — прежнее имя файла, остальные районы — по слагам edu.tatar.ru
    f = cache / ('edu_tatar_contingent.json' if tuple(districts) == ('sovetcki', 'priv') else f"edu_tatar_{'_'.join(districts)}.json")
    if not f.exists():
        rows = []
        for district in districts:
            for ty in (1, 4):
                idx = fetch(f'https://edu.tatar.ru/{district}/type/{ty}').decode('utf-8', 'ignore')
                for href, name in re.findall(r'href="(/' + district + r'/[^"]+)"[^>]*>\s*([^<]{3,200})<', idx):
                    t = re.sub(r'<[^>]+>', ' ', fetch('https://edu.tatar.ru' + href).decode('utf-8', 'ignore'))
                    t = re.sub(r'\s+', ' ', html.unescape(t))
                    m = re.search(r'У нас (?:учатся|воспитываются|обучаются)[^:]*:\s*(\d[\d\s]*)', t)
                    a = re.search(r'Адрес:\s*(.{5,160}?)\s+Телефон', t)
                    rows.append({'district': district, 'type': 'school' if ty == 1 else 'kindergarten', 'name': html.unescape(name.strip()),
                                 'url': 'https://edu.tatar.ru' + href, 'students': int(m.group(1).replace(' ', '')) if m else None,
                                 'address': a.group(1) if a else None})
                    time.sleep(0.3)
        f.write_text(json.dumps({'fetched': time.strftime('%Y-%m-%d'), 'rows': rows}, ensure_ascii=False), encoding='utf-8')
    return json.loads(f.read_text(encoding='utf-8'))


# ---------- геометрия ----------
KX, KY = 62600.0, 111200.0  # метров в градусе долготы / широты на широте Казани (cos 55,75° × 111,32 км)


def dist(a, b):
    return math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)


def ring_of(el):
    g = el.get('geometry')
    return [(p['lon'], p['lat']) for p in g] if g else None


def area(ring):
    return abs(sum(ring[i][0] * KX * ring[i - 1][1] * KY - ring[i - 1][0] * KX * ring[i][1] * KY for i in range(len(ring)))) / 2


def centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def inside(pt, ring):
    x, y, c = pt[0], pt[1], False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1], ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def outer_rings(el):
    """Кольца полигона: way — сам контур, relation — внешние участники."""
    if el['type'] == 'way':
        r = ring_of(el)
        return [r] if r and len(r) > 3 else []
    return [[(p['lon'], p['lat']) for p in m['geometry']] for m in el.get('members', [])
            if m.get('role') == 'outer' and m.get('geometry') and len(m['geometry']) > 3]


def num_of(name):
    m = re.search(r'№\s*(\d+)', name or '')
    return int(m.group(1)) if m else None


def levels(tags):
    for k in ('building:levels',):
        try:
            return max(1.0, float(tags[k].replace(',', '.')))
        except (KeyError, ValueError):
            pass
    return None


def cluster(points, radius):
    """Жадная кластеризация точек (узлы светофоров одного перекрёстка, два павильона одной остановки)."""
    groups = []
    for p in points:
        for g in groups:
            if dist(g['c'], p['c']) <= radius:
                g['items'].append(p)
                n = len(g['items'])
                g['c'] = ((g['c'][0] * (n - 1) + p['c'][0]) / n, (g['c'][1] * (n - 1) + p['c'][1]) / n)
                break
        else:
            groups.append({'c': p['c'], 'items': [p]})
    return groups


def r5(p):
    return [round(p[0], 5), round(p[1], 5)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='C:/tmp/kzn')
    ap.add_argument('--registry', default=None, help='zip реестра (нужен, если нет кэша edu_kazan.json)')
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'public' / 'data' / 'kazan.json'))
    # другой район: границы (можно несколько), районы edu.tatar.ru, название и участок ЖК по умолчанию
    ap.add_argument('--bbox', action='append', help='юг,запад,север,восток в градусах; по умолчанию — Азино и юго-запад Приволжского района')
    ap.add_argument('--edu', default='sovetcki,priv', help='слаги районов edu.tatar.ru через запятую: sovetcki, priv, nsav, …')
    ap.add_argument('--name', default='Казань: Азино и юго-запад Приволжского района (открытые данные)')
    ap.add_argument('--site', default=None, help='долгота,широта центра участка ЖК по умолчанию (Ново-Савиновский: 49.1426,55.813)')
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    bboxes = {f"osm_{b.replace(',', '_')}.json": tuple(float(x) for x in b.split(',')) for b in a.bbox} if a.bbox else BBOXES
    E = load_osm(cache, bboxes)
    reg = load_registry(cache, a.registry)
    cont = load_contingent(cache, tuple(a.edu.split(',')))

    # ---------- здания ----------
    buildings, bld_index = [], []
    for el in E:
        t = el.get('tags', {})
        if el['type'] not in ('way', 'relation') or 'building' not in t:
            continue
        rings = outer_rings(el)
        if not rings:
            continue
        ring = max(rings, key=area)
        inner = sum(area([(p['lon'], p['lat']) for p in m['geometry']]) for m in el.get('members', []) if m.get('role') == 'inner' and m.get('geometry'))
        foot = sum(area(r) for r in rings) - inner
        if len(ring) < 4 or foot < 15:
            continue
        b = t['building']
        lv = levels(t)
        try:
            h = float(t['height'].replace(',', '.').split()[0])
        except (KeyError, ValueError):
            h = (lv or DEFAULT_LEVELS.get(b, 2)) * 3.0
        kind = ('res' if b in ('apartments', 'residential', 'dormitory') else 'house' if b in ('house', 'detached', 'semidetached_house', 'terrace', 'bungalow')
                else 'edu' if b in ('school', 'kindergarten') else 'com' if b in ('retail', 'commercial', 'office', 'supermarket', 'mall') else 'other')
        flats = t.get('building:flats')
        flats = int(flats) if flats and flats.isdigit() else 0
        # год постройки (start_date, building:year) — для проверки прогноза на построенных ЖК; 0 — не указан
        ym = re.search(r'(1[89]\d\d|20[0-3]\d)', str(t.get('start_date') or t.get('building:year') or t.get('construction_date') or ''))
        buildings.append([kind, round(h, 1), flats, [r5(p) for p in ring], int(ym.group(1)) if ym else 0])
        bld_index.append({'ring': ring, 'c': centroid(ring), 'gfa': foot * (lv or DEFAULT_LEVELS.get(b, 2)), 'b': b, 'lv': lv})

    # ---------- дороги ----------
    roads = []
    for el in E:
        t = el.get('tags', {})
        if el['type'] == 'way' and 'highway' in t and 'geometry' in el:
            roads.append([t['highway'], t.get('name', ''), int(t['lanes']) if t.get('lanes', '').isdigit() else 0, [r5(p) for p in ring_of(el)]])

    objects = []

    # ---------- школы и сады: OSM-участок (геометрия) + реестр (ИНН, лицензия) + edu.tatar.ru (контингент) ----------
    sites = []
    for el in E:
        t = el.get('tags', {})
        if t.get('amenity') in ('school', 'kindergarten'):
            rings = outer_rings(el)
            c = centroid(rings[0]) if rings else ((el['lon'], el['lat']) if el['type'] == 'node' else None)
            if c:
                sites.append({'kind': t['amenity'], 'name': t.get('name', ''), 'num': num_of(t.get('name')), 'rings': rings, 'c': c, 'used': False})

    def gfa_of(site):
        total, n, estimated_lv = 0.0, 0, 0
        for b in bld_index:
            if any(inside(b['c'], r) for r in site['rings']) or (not site['rings'] and dist(b['c'], site['c']) < 40):
                if b['b'] in ('garages', 'garage', 'shed', 'roof', 'service'):
                    continue
                total += b['gfa']
                n += 1
                estimated_lv += b['lv'] is None
        return total, n, estimated_lv

    (s, w, n_, e) = (min(v[0] for v in bboxes.values()), min(v[1] for v in bboxes.values()), max(v[2] for v in bboxes.values()), max(v[3] for v in bboxes.values()))
    in_bbox = lambda c: s <= c[1] <= n_ and w <= c[0] <= e and any(b[0] <= c[1] <= b[2] and b[1] <= c[0] <= b[3] for b in bboxes.values())

    for row in cont['rows']:
        kind, num = row['type'], num_of(row['name'])
        if num is None:
            continue
        cands = [r for r in reg[kind] if num_of(r['Краткое наименование']) == num and r['Широта']]
        street = re.search(r'ул\.?\s*([А-Яа-яЁё\-]+)', row['address'] or '')
        if len(cands) > 1 and street:
            cands = [r for r in cands if street.group(1)[:5].lower() in r['Адрес'].lower()] or cands
        cands = [r for r in cands if r['Форма'] in ('МБУ', 'МАУ', '')] or cands
        r = cands[0] if cands else None
        rc = (float(r['Долгота']), float(r['Широта'])) if r else None
        site = next((x for x in sites if x['kind'] == kind and x['num'] == num and (rc is None or dist(x['c'], rc) < 1500)), None)
        if site is None and rc:
            near = [x for x in sites if x['kind'] == kind and not x['used'] and dist(x['c'], rc) < 150]
            site = min(near, key=lambda x: dist(x['c'], rc)) if near else None
        c = site['c'] if site else rc
        if not c or not in_bbox(c):
            continue
        obj = {'id': f"{'kg' if kind == 'kindergarten' else 'sc'}{num}", 'kind': kind, 'name': row['name'].replace('"', '«', 1).replace('"', '»', 1),
               'coords': r5(c), 'info': {}}
        if row['students']:
            obj['load'] = row['students']
            obj['info']['load'] = {'status': 'факт', 'text': f"контингент {row['students']} — edu.tatar.ru, визитная карточка, {cont['fetched']}", 'url': row['url']}
        if site:
            site['used'] = True
            gfa, nb, est = gfa_of(site)
            if gfa > 300:
                hi_m2, lo_m2, mid_m2 = M2_PER_PLACE[kind]
                obj['capacity'] = round(gfa / mid_m2, -1)
                obj['capacityRange'] = [round(gfa / hi_m2, -1), round(gfa / lo_m2, -1)]
                obj['info']['capacity'] = {'status': 'оценка', 'text': (
                    f"оценка по площади зданий OSM: {round(gfa):,} м² ({nb} корп.{', этажность по умолчанию у ' + str(est) if est else ''}) / "
                    f"{lo_m2}–{hi_m2} м² на место; открытого реестра проектной мощности нет").replace(',', ' ')}
        if r:
            obj['info']['registry'] = {'status': 'факт', 'text': f"реестр лицензий Рософнадзора (25.08.2026): {r['Краткое наименование']}, ИНН {r['ИНН']}, {r['Адрес']}".replace('Рософ', 'Рособр'), 'url': r['Ссылка на лицензию']}
        objects.append(obj)

    for x in sites:  # участки из OSM без контингента — объект без данных, вывод о достаточности не делается
        if not x['used'] and in_bbox(x['c']) and x['name']:
            objects.append({'id': f"osm-{x['kind'][:2]}-{len(objects)}", 'kind': x['kind'], 'name': x['name'], 'coords': r5(x['c']),
                            'info': {'load': {'status': 'нет данных', 'text': 'объект есть в OSM, контингент и мощность не найдены'}}})

    # ---------- перекрёстки со светофорами ----------
    lanes_default = {'motorway': 6, 'trunk': 6, 'primary': 4, 'secondary': 4, 'tertiary': 2, 'residential': 2, 'unclassified': 2, 'living_street': 1}
    rank = {'motorway': 5, 'trunk': 5, 'primary': 4, 'secondary': 3, 'tertiary': 2, 'residential': 1, 'unclassified': 1, 'living_street': 0}
    base_z = {5: 0.8, 4: 0.75, 3: 0.65, 2: 0.5, 1: 0.35, 0: 0.3}
    road_pts = [(rd, p) for rd in roads for p in rd[3]]
    sig = [{'c': (el['lon'], el['lat'])} for el in E if el.get('tags', {}).get('highway') == 'traffic_signals' and el['type'] == 'node']
    for i, g in enumerate(cluster(sig, 60)):
        near = {}
        for rd, p in road_pts:
            if dist(p, g['c']) < 45 and rd[1]:
                cur = near.get(rd[1])
                if cur is None or rank.get(rd[0], 0) > rank.get(cur[0], 0):
                    near[rd[1]] = rd
        if not near:
            continue
        top = sorted(near.values(), key=lambda rd: -rank.get(rd[0], 0))[:2]
        lanes = sum((rd[2] or lanes_default.get(rd[0], 2)) for rd in top) if len(top) > 1 else (top[0][2] or lanes_default.get(top[0][0], 2)) * 2
        # Пропускная способность узла: поток насыщения ≈ 525 × 3,5 м ≈ 1 840 авт./ч на полосу (ОДМ 218.6.003-2011, Мн = 525·B)
        # × доля зелёного 0,45 на каждое направление; суммарно по всем подходам.
        cap = round(1840 * 0.45 * lanes, -1)
        z0 = base_z[max(rank.get(rd[0], 0) for rd in top)]
        name = ' × '.join(rd[1] for rd in top)
        objects.append({'id': f'x{i}', 'kind': 'intersection', 'name': name, 'coords': r5(g['c']), 'capacity': cap, 'load': round(cap * z0, -1),
                        'info': {'capacity': {'status': 'оценка', 'text': f'{lanes} полос на подходах × 1 840 авт./ч (ОДМ 218.6.003-2011) × доля зелёного 0,45'},
                                 'load': {'status': 'синтетика', 'text': f'нет данных детекторов: базовая загрузка z = {z0} по классу улицы (допущение)'}}})

    # ---------- остановки ----------
    stops = [{'c': (el['lon'], el['lat']), 'name': el['tags'].get('name', '')} for el in E if el['type'] == 'node' and
             (el.get('tags', {}).get('highway') == 'bus_stop' or el.get('tags', {}).get('public_transport') == 'platform')]
    for i, g in enumerate(cluster(stops, 80)):
        nm = next((x['name'] for x in g['items'] if x['name']), 'Остановка')
        objects.append({'id': f'st{i}', 'kind': 'stop', 'name': nm, 'coords': r5(g['c']),
                        'info': {'load': {'status': 'нет данных', 'text': 'пассажиропоток и провозная способность маршрутов не опубликованы'}}})

    # ---------- торговля, аптеки, парковки, поликлиники, спорт, метро ----------
    def point(el):
        if el['type'] == 'node':
            return (el['lon'], el['lat'])
        rs = outer_rings(el)
        return centroid(rs[0]) if rs else None
    for el in E:
        t = el.get('tags', {})
        c = point(el)
        if not c or not in_bbox(c):
            continue
        if t.get('shop') in DAILY_SHOPS or t.get('amenity') == 'pharmacy':
            kind = 'pharmacy' if t.get('amenity') == 'pharmacy' else 'shop'
            objects.append({'id': f"{kind}{el['id']}", 'kind': kind, 'name': t.get('name') or t.get('brand') or ('Аптека' if kind == 'pharmacy' else 'Магазин'),
                            'coords': r5(c), 'info': {'load': {'status': 'нет данных', 'text': 'торговая площадь и загрузка не известны (OSM даёт только местоположение)'}}})
        elif t.get('amenity') == 'parking' and t.get('access') not in ('private', 'no'):
            rs = outer_rings(el)
            cap = int(t['capacity']) if t.get('capacity', '').isdigit() else (round(area(rs[0]) / 25) if rs else 0)
            if cap < 20:
                continue
            objects.append({'id': f"pk{el['id']}", 'kind': 'parking', 'name': t.get('name') or 'Открытая стоянка', 'coords': r5(c), 'capacity': cap,
                            'info': {'capacity': {'status': 'факт' if t.get('capacity') else 'оценка', 'text': 'capacity из OSM' if t.get('capacity') else 'площадь стоянки / 25 м² на место с проездами (допущение)'},
                                     'load': {'status': 'нет данных', 'text': 'заполняемость стоянки не известна'}}})
        elif t.get('amenity') in ('clinic', 'hospital', 'doctors') and t.get('name'):
            objects.append({'id': f"cl{el['id']}", 'kind': 'clinic', 'name': t['name'], 'coords': r5(c), 'info': {'load': {'status': 'нет данных', 'text': 'мощность (посещений в смену) не опубликована'}}})
        elif t.get('leisure') in ('sports_centre', 'stadium', 'fitness_centre') and t.get('name'):
            objects.append({'id': f"sp{el['id']}", 'kind': 'sport', 'name': t['name'], 'coords': r5(c), 'info': {'load': {'status': 'нет данных', 'text': 'единовременная пропускная способность не известна'}}})
        elif t.get('landuse') == 'construction' and (t.get('construction') == 'subway' or 'метро' in (t.get('name') or '').lower()):
            # 1-й участок 2-й линии: Госстройнадзор РТ — август 2027, Минстрой РТ — 2028; берём консервативно 2028
            objects.append({'id': f"mt{el['id']}", 'kind': 'metro', 'name': 'Станция метро' + (f" «{t['name']}»" if t.get('name') and 'метро' not in t['name'].lower() else ' (строится)'),
                            'coords': r5(c), 'openYear': 2028, 'info': {'load': {'status': 'факт', 'text': 'стройплощадка 2-й линии метро (OSM); открытие — 2028 (консервативно: Госстройнадзор РТ называл август 2027, Минстрой РТ — 2028)', 'url': 'https://m.business-gazeta.ru/news/702229'}}})

    # Проверенные факты (ручная сверка по СМИ и сайтам) — перекрывают оценки
    facts_file = Path(__file__).with_name('facts.json')
    for f in json.loads(facts_file.read_text(encoding='utf-8')) if facts_file.exists() else []:
        o = next((o for o in objects if o['id'] == f['id']), None)
        if o is None:
            continue
        for k in ('capacity', 'load'):
            if k in f:
                o[k] = f[k]
                o['info'][k] = {'status': 'факт', 'text': f[k + 'Text'], 'url': f['url']}
                if k == 'capacity':
                    o.pop('capacityRange', None)

    # Перекрёстки: одноимённые кластеры ближе 150 м — один узел
    xs = [o for o in objects if o['kind'] == 'intersection']
    for o in xs:
        for p in xs:
            if p is not o and not p.get('dup') and not o.get('dup') and p['name'] == o['name'] and dist(p['coords'], o['coords']) < 150:
                p['dup'] = True
    objects = [o for o in objects if not o.get('dup')]

    # ---------- вода и озеленённые территории ----------
    ground = []
    for el in load_ground(cache, bboxes):
        t = el.get('tags', {})
        kind = 'water' if t.get('natural') in ('water', 'wetland') or t.get('waterway') == 'riverbank' else 'park'
        if el['type'] == 'way':
            r = ring_of(el)
            rings = [r] if r and len(r) > 3 and r[0] == r[-1] else []
        else:
            rings = stitch([[(p['lon'], p['lat']) for p in m['geometry']] for m in el.get('members', []) if m.get('role') == 'outer' and m.get('geometry')])
        for r in rings:
            if area(r) > 400:
                ground.append([kind, [r5(p) for p in r]])

    flats = sum(b[2] for b in buildings)
    out = {
        'name': a.name,
        'synthetic': False,
        'dataDate': cont['fetched'],
        'sources': [
            {'title': 'OpenStreetMap (Overpass API)', 'url': 'https://www.openstreetmap.org/copyright', 'note': '© участники OpenStreetMap, ODbL', 'date': time.strftime('%Y-%m-%d')},
            {'title': 'Реестр лицензий на образовательную деятельность (Рособрнадзор)', 'url': 'https://islod.obrnadzor.gov.ru/', 'note': 'выгрузка 25.08.2026; персональные данные не используются', 'date': '2026-08-25'},
            {'title': 'Электронное образование в РТ, визитные карточки организаций', 'url': 'https://edu.tatar.ru/', 'note': 'фактический контингент', 'date': cont['fetched']},
        ],
        'stats': {'buildings': len(buildings), 'flats': flats, 'objects': len(objects)},
        **({'site': [float(x) for x in a.site.split(',')]} if a.site else {}),
        'objects': objects,
        'buildings': buildings,
        'roads': roads,
        'ground': ground,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    from collections import Counter
    print(a.out, round(Path(a.out).stat().st_size / 1e6, 1), 'МБ', out['stats'], Counter(o['kind'] for o in objects))


if __name__ == '__main__':
    main()
