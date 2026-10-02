# Вместимость всех школ и садов Казани → capacity_all.json (схема — для дашборда, ключ — ИНН).
#   школы, новые здания и корпуса 2015–2025 — проект (new_schools_capacity.json, цитаты проверены capacity_load.py);
#   прочие школы — площадь этажей участка по OpenStreetMap / м² на место для старых зданий
#     (old_schools_capacity.json, если собран; иначе предварительно — медиана м² на ученика, т. е. «медианная загрузка 100%»);
#   сады — площадь этажей / м² на место, подобранные так, чтобы сумма мест = мест на ребёнка по Казани (Росстат 2023: 64,7 тыс. на 73,7 тыс.);
#   нет здания в OSM или участок общий — медианная загрузка района.
# Калибровка новых школ: 8 зданий, 18,5 м²/место, проверка без одной школы — ошибка 3% (максимум 14%).
import json, math, re, statistics, sys, pathlib, pickle
from collections import Counter, defaultdict
import osmium
sys.stdout.reconfigure(encoding='utf-8')
HERE = pathlib.Path(__file__).parent
PBF = 'C:/tmp/demo/kzn/goroda/tatarstan.osm.pbf'
BB = (48.82, 55.60, 49.39, 55.94)  # Казань
LAT0 = 55.79
KG_PLACES_PER_CHILD = 64.7 / 73.7  # Росстат, «Показатели городов» 2024: места и воспитанники 2023 г.
BAND = 0.25                        # ponytail: диапазон ±25% там, где калибровки нет (сады, медиана района)
mx = lambda lon: lon * 111320 * math.cos(math.radians(LAT0))
my = lambda lat: lat * 110574

def ring_xy(r): return [(mx(n.lon), my(n.lat)) for n in r]
def area(xy): return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(xy, xy[1:] + xy[:1]))) / 2
def inside(pt, xy):
    x, y, c = *pt, False
    for (x1, y1), (x2, y2) in zip(xy, xy[1:] + xy[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def in_g(pt, g):  # сначала габарит участка — иначе сотни тысяч проверок многоугольника
    x, y = pt; b = g.get('bb')
    return bool(b) and b[0] <= x <= b[2] and b[1] <= y <= b[3] and any(inside(pt, r) for r in g['rings'])
def levels(tags):
    m = re.match(r'\s*(\d+(?:[.,]\d+)?)', tags.get('building:levels', ''))
    return float(m.group(1).replace(',', '.')) if m else None

EDU = ('school', 'kindergarten')
def load():  # один проход по выгрузке Татарстана (~4 мин), дальше — кэш
    cache = HERE / 'osm_edu_cache.pkl'
    if cache.exists(): return pickle.load(open(cache, 'rb'))
    grounds, bld = [], []
    for o in osmium.FileProcessor(PBF).with_areas():
        if not o.is_area(): continue
        t = o.tags
        if 'building' not in t and t.get('amenity') not in EDU: continue
        outer = [ring_xy(r) for r in o.outer_rings()]
        if not outer or not outer[0]: continue
        c = (sum(x for x, _ in outer[0]) / len(outer[0]), sum(y for _, y in outer[0]) / len(outer[0]))
        if not (mx(BB[0]) < c[0] < mx(BB[2]) and my(BB[1]) < c[1] < my(BB[3])): continue
        if t.get('amenity') in EDU and 'building' not in t:
            xs, ys = [x for r in outer for x, _ in r], [y for r in outer for _, y in r]
            grounds.append({'kind': t['amenity'], 'rings': outer, 'c': c, 'bb': (min(xs), min(ys), max(xs), max(ys))})
        else:
            edu = t.get('amenity') if t.get('amenity') in EDU else t.get('building') if t.get('building') in EDU else None
            bld.append({'c': c, 'a': sum(area(r) for r in outer), 'lv': levels(t), 'edu': edu})
    pickle.dump((grounds, bld), open(cache, 'wb'))
    return grounds, bld

def attach(grounds, bld):  # здание → участок по центру; отдельное здание школы/сада без участка — сам себе участок
    for g in grounds: g['b'] = []
    for b in bld:
        g = next((g for g in grounds if in_g(b['c'], g)), None)
        if g: g['b'].append(b)
        elif b['edu']: grounds.append({'kind': b['edu'], 'rings': [], 'c': b['c'], 'b': [b]})
    for g in grounds:
        lv = [b['lv'] for b in g['b'] if b['lv']]
        g['lv_known'] = len(lv) == len(g['b']) and bool(lv)
        med = statistics.median(lv) if lv else (3 if g['kind'] == 'school' else 2)  # ponytail: нет этажности — типовые 3 (школа) / 2 (сад)
        g['floor'] = sum(b['a'] * (b['lv'] or med) for b in g['b'] if b['a'] > 150)  # мелочь < 150 м² не считаем

def match(orgs, grounds, kind):
    gs = [g for g in grounds if g['kind'] == kind]
    for s in orgs:
        pt = (mx(float(s['долгота'])), my(float(s['широта'])))
        g = next((g for g in gs if in_g(pt, g)), None)
        if not g:  # точка адреса часто на улице — ближайший участок в 150 м
            d, g = min(((math.dist(pt, g['c']), g) for g in gs), key=lambda x: x[0])
            g = g if d < 150 else None
        s['g'] = g
    n = Counter(id(s['g']) for s in orgs if s['g'])
    for s in orgs: s['g_ok'] = bool(s['g'] and s['g']['floor'] and n[id(s['g'])] == 1)

def find(S, num, dist, kind):
    h = [s for s in S if s['район'] == dist and re.search(rf'№\s*{num}\b', s['название']) and kind in s['название'].lower()]
    return h[0] if len(h) == 1 else None

if __name__ == '__main__':
    grounds, bld = load()
    attach(grounds, bld)
    ALL = json.load(open(HERE / 'kazan_schools.json', encoding='utf-8'))
    SCH = [s for s in ALL if s['тип'] == 'школа' and s['учеников 2026']]
    KG = [s for s in ALL if s['тип'] == 'детский сад' and s['учеников 2026']]
    match(SCH, grounds, 'school'); match(KG, grounds, 'kindergarten')
    out = {}

    # --- школы: проект (новые здания и корпуса)
    caps = json.load(open(HERE / 'new_schools_capacity.json', encoding='utf-8'))
    korp = {(r['number'], r['district']) for r in caps if r['kind'] == 'корпус/пристрой'}
    parts, cal = defaultdict(list), []
    for r in caps:
        if not r['capacity'] or not isinstance(r['number'], int) or r['kind'] not in ('новое здание', 'корпус/пристрой'): continue
        s = find(SCH, r['number'], r['district'], next(w for w in ('лицей', 'гимназия', 'школа') if w in r['name'].lower()))
        if not s: continue
        parts[s['ИНН']].append({'opened': r['opened'], 'capacity': r['capacity'], 'url': r['url'], 'kind': r['kind']})
        if r['kind'] == 'новое здание' and (r['number'], r['district']) not in korp and s['g_ok']: cal.append(s['g']['floor'] / r['capacity'])
    whole = {inn for inn, ps in parts.items() if any(p['kind'] == 'новое здание' for p in ps)}  # у корпусов старых школ основное здание неизвестно
    for inn in whole:
        ps = parts[inn]; c = sum(p['capacity'] for p in ps)
        out[inn] = {'type': 'school', 'capacity': c, 'lo': c, 'hi': c, 'source': 'проект', 'url': ps[0]['url'],
                    'parts': [{'opened': p['opened'], 'capacity': p['capacity']} for p in sorted(ps, key=lambda p: p['opened'] or 0)]}
    K_NEW = statistics.median(cal)

    # --- школы: старые здания по площади
    old_f = HERE / 'old_schools_capacity.json'
    old_k = []
    SKIP = {(18, 'Приволжский'): 'на участке новый корпус 2022', (19, 'Приволжский'): 'на участке новый корпус 2024',
            (20, 'Московский'): 'вторичный источник, мощность под сомнением', (171, 'Советский'): 'два источника: 936 и 1266'}
    if old_f.exists():
        for r in json.load(open(old_f, encoding='utf-8')):
            if not r.get('capacity') or not r.get('quote_verified') or not isinstance(r.get('number'), int) or not r.get('district'): continue
            if (r['number'], r['district']) in SKIP: continue
            s = next((s for s in SCH if s['район'] == r['district'] and re.search(rf'№\s*{r["number"]}\b', s['название'])), None)
            if s and s['g_ok'] and s['ИНН'] not in out:
                old_k.append(s['g']['floor'] / r['capacity'])
                print(f"  старая №{r['number']:<4} {r['district']:17} мест {r['capacity']:5}  площадь этажей OSM {s['g']['floor']:7.0f} → {old_k[-1]:.1f} м²/место")
    if len(old_k) >= 5:
        loo = [abs(k / statistics.median([x for j, x in enumerate(old_k) if j != i]) - 1) for i, k in enumerate(old_k)]
        print(f"старые школы: {len(old_k)}, медиана {statistics.median(old_k):.1f} м²/место; проверка без одной: ошибка медиана {statistics.median(loo):.0%}, макс {max(loo):.0%}")
    rest = [s for s in SCH if s['ИНН'] not in out and s['g_ok']]
    if len(old_k) >= 5:
        K_OLD, K_LO, K_HI, k_src = statistics.median(old_k), min(old_k), max(old_k), f'старые школы с известной мощностью: {len(old_k)}'
    else:  # предварительно: медианная загрузка 100% (м² на ученика), диапазон ±25%
        K_OLD = statistics.median(s['g']['floor'] / s['учеников 2026'] for s in rest)
        K_LO, K_HI, k_src = K_OLD * (1 - BAND), K_OLD * (1 + BAND), 'предварительно: медиана м² на ученика (калибровка по старым школам не собрана)'
    for s in rest:
        f = s['g']['floor']
        if not 0.3 <= s['учеников 2026'] * K_OLD / f <= 2.0: continue  # третья смена запрещена: > 200% — в OSM не то здание → медиана района
        out[s['ИНН']] = {'type': 'school', 'capacity': round(f / K_OLD), 'lo': round(f / K_HI), 'hi': round(f / K_LO),
                         'source': 'оценка по площади OSM', 'url': None, 'parts': [{'opened': None, 'capacity': round(f / K_OLD)}]}

    # --- сады: площадь, нормированная на места Росстата
    kg_ok = [s for s in KG if s['g_ok']]
    for _ in range(3):  # сад, встроенный в жилой дом, или чужое здание у точки адреса дают 300–700% — отбрасываем и перенормируем
        K_KG = sum(s['g']['floor'] for s in kg_ok) / (KG_PLACES_PER_CHILD * sum(s['учеников 2026'] for s in kg_ok))
        kg_ok = [s for s in KG if s['g_ok'] and 0.5 <= s['учеников 2026'] * K_KG / s['g']['floor'] <= 1.6]
    for s in kg_ok:
        c = round(s['g']['floor'] / K_KG)
        out[s['ИНН']] = {'type': 'kg', 'capacity': c, 'lo': round(c * (1 - BAND)), 'hi': round(c * (1 + BAND)),
                         'source': 'оценка по площади OSM', 'url': None, 'parts': [{'opened': None, 'capacity': c}]}

    # --- остальные: медианная загрузка района
    for typ, orgs in (('school', SCH), ('kg', KG)):
        for s in orgs:
            if s['ИНН'] in out: continue
            loads = [o['учеников 2026'] / out[o['ИНН']]['capacity'] for o in orgs if o['ИНН'] in out and o['район'] == s['район']]
            c = round(s['учеников 2026'] / statistics.median(loads))
            out[s['ИНН']] = {'type': typ, 'capacity': c, 'lo': round(c * (1 - BAND)), 'hi': round(c * (1 + BAND)),
                             'source': 'медиана района', 'url': None, 'parts': [{'opened': None, 'capacity': c}]}

    meta = {'k_new_m2_per_place': round(K_NEW, 1), 'k_old_m2_per_place': round(K_OLD, 1), 'k_old_source': k_src,
            'k_kg_m2_per_place': round(K_KG, 1), 'kg_anchor': 'Росстат 2023: 64,7 тыс. мест на 73,7 тыс. детей',
            'sources': dict(Counter((v['type'], v['source']) for v in out.values()).most_common()).__repr__()}
    json.dump({'meta': meta, 'orgs': out}, open(HERE / 'capacity_all.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for typ, orgs in (('school', SCH), ('kg', KG)):
        P, C = sum(s['учеников 2026'] for s in orgs), sum(out[s['ИНН']]['capacity'] for s in orgs)
        print(f"{typ}: организаций {len(orgs)}, детей {P}, мест {C}, загрузка {P / C:.0%}", Counter(out[s['ИНН']]['source'] for s in orgs))
    print(meta)
    assert len(out) == len(SCH) + len(KG) and all(v['lo'] <= v['capacity'] <= v['hi'] for v in out.values())
