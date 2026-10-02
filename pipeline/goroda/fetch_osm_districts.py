# Квартиры многоквартирных домов по 7 районам Казани из OSM → osm_districts.json (по району: дома, квартиры, по годам ввода).
# Зеркало Overpass Mail.ru (основной overpass-api.de с этой машины отвечает 406 — см. TOOLKIT). Один запрос на район.
import json, re, pathlib, subprocess, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).parent
APIS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']  # живость зеркал меняется по часам

def q(ql):  # зеркала по кругу; ответ не JSON (ошибка диспетчера, 504, таймаут) — следующее зеркало; до 30 кругов с паузой
    for attempt in range(30 * len(APIS)):
        if attempt and attempt % len(APIS) == 0: time.sleep(20)
        api = APIS[attempt % len(APIS)]
        r = subprocess.run(['curl', '-s', '-m', '90', '-A', 'zastroyka-hackathon/1.0', '--data-urlencode', f'data={ql}', api], capture_output=True)
        try: return json.loads(r.stdout.decode('utf-8'))
        except ValueError: print('  повтор:', api.split('/')[2], r.stdout[:80])
    raise RuntimeError('Overpass недоступен')

def districts():  # районы Казани: административные границы 9-го уровня внутри городского округа
    ql = ('[out:json][timeout:120];rel["boundary"="administrative"]["name"~"^(Авиастроительный|Вахитовский|Кировский|Московский|'
          'Ново-Савиновский|Приволжский|Советский) район$"](55.65,48.80,55.95,49.35);out tags;')  # в bbox Казани — без одноимённых районов других городов
    return {e['id']: e['tags']['name'] for e in q(ql)['elements'] if 'район' in e['tags'].get('name', '')}

PBF = ROOT / 'tatarstan.osm.pbf'  # openstreetmap.fr/extracts/russia/volga_federal_district/tatarstan_republic-latest.osm.pbf — когда Overpass лежит

def houses_pbf():  # те же дома из файла-выгрузки: центр — среднее узлов контура
    import osmium
    s_, w_, n_, e_ = map(float, BBOX.split(','))
    rows = []
    IZHS = {'house', 'detached', 'semidetached_house'}  # частный дом = 1 квартира
    for w in osmium.FileProcessor(str(PBF)).with_locations().with_filter(osmium.filter.KeyFilter('building')):
        if not w.is_way() or ('building:flats' not in w.tags and w.tags.get('building') not in IZHS): continue
        pts = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
        if not pts: continue
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if not (w_ <= c[0] <= e_ and s_ <= c[1] <= n_): continue
        t = dict(w.tags)
        try: f = int(re.match(r'\d+', t.get('building:flats', '1')).group())
        except (AttributeError, ValueError): continue
        rows.append((c, f, year(t)) if f >= 4 else (c, -max(f, 1), None))  # f < 0 — частный дом (1–3 кв.)
    return rows

def year(t):
    m = re.search(r'(1[89]\d\d|20[0-3]\d)', t.get('start_date', '') or t.get('building:year', ''))
    return int(m.group(1)) if m else None

BBOX = '55.60,48.82,55.94,49.39'  # Казань с запасом; пригороды отсекает проверка «точка в полигоне»

def borders(ids):  # район → отрезки границы из Nominatim (одним запросом; Overpass под нагрузкой отдаёт 504)
    url = 'https://nominatim.openstreetmap.org/lookup?format=json&polygon_geojson=1&osm_ids=' + ','.join(f'R{i}' for i in ids)
    r = subprocess.run(['curl', '-s', '-m', '60', '-A', 'zastroyka-hackathon/1.0', url], capture_output=True)
    out = {}
    for e in json.loads(r.stdout.decode('utf-8')):
        g = e['geojson']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        segs = [(tuple(a), tuple(b)) for poly in polys for ring in poly for a, b in zip(ring, ring[1:])]  # с дырками — луч учтёт и их
        xs = [p[0] for s_ in segs for p in s_]; ys = [p[1] for s_ in segs for p in s_]
        out[int(e['osm_id'])] = (segs, (min(xs), min(ys), max(xs), max(ys)))
    return out

def inside(pt, segs):
    x, y, c = pt[0], pt[1], False
    for (x1, y1), (x2, y2) in segs:
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): c = not c
    return c

def tiles(step=0.05):  # большой bbox зеркала роняют по таймауту (504) — режем на плитки ~5×3 км
    s, w, n, e = map(float, BBOX.split(','))
    la = s
    while la < n:
        lo = w
        while lo < e:
            yield f'{la:.2f},{lo:.2f},{min(la + step, n):.2f},{min(lo + step * 1.8, e):.2f}'
            lo += step * 1.8
        la += step

def houses():
    rows, els = [], {}
    for i, t in enumerate(tiles()):
        f = ROOT / 'osm_tiles' / f'{t}.json'  # кэш плитки: перезапуск не качает заново
        if not f.exists():
            f.parent.mkdir(exist_ok=True)
            f.write_text(json.dumps(q(f'[out:json][timeout:60];way["building"]["building:flats"]({t});out tags center;')['elements']), encoding='utf-8')
        for e in json.loads(f.read_text(encoding='utf-8')): els[e['id']] = e  # дом на стыке плиток — один раз
        print(f'  плитка {i + 1}: всего домов {len(els)}', flush=True)
    for e in els.values():
        try: f = int(re.match(r'\d+', e['tags']['building:flats']).group())
        except (AttributeError, ValueError): continue
        if f >= 4 and 'center' in e: rows.append(((e['center']['lon'], e['center']['lat']), f, year(e['tags'])))  # ponytail: дома 1–3 кв. не считаем — коэффициент «на квартиру МКД»
    return rows

if __name__ == '__main__':
    ds = {2133461: 'Авиастроительный район', 2133462: 'Вахитовский район', 2133463: 'Кировский район', 2133464: 'Московский район',
          2133465: 'Ново-Савиновский район', 2133466: 'Приволжский район', 2133467: 'Советский район'}  # districts() — id районов, найдены 01.10.2026
    print('районы:', ds)
    bd = borders(ds)
    hs = houses_pbf() if PBF.exists() else houses()
    print('домов с квартирами в bbox:', len(hs))
    res = {rid: [(f, y) for pt, f, y in hs if bb[0] <= pt[0] <= bb[2] and bb[1] <= pt[1] <= bb[3] and inside(pt, segs)] for rid, (segs, bb) in bd.items()}
    out = {}
    for rid, rows in res.items():
        izhs = -sum(f for f, _ in rows if f < 0)
        rows = [(f, y) for f, y in rows if f > 0]
        by = {}
        for f, y in rows:
            k = 'нет' if y is None else 'до 2000' if y < 2000 else '2000–2009' if y < 2010 else '2010–2016' if y < 2017 else '2017–2026'
            by[k] = by.get(k, 0) + f
        out[ds[rid]] = {'houses': len(rows), 'flats': sum(f for f, _ in rows), 'izhs': izhs, 'by_year': by}
        print(f'{ds[rid]:28} домов {len(rows):5}  квартир {out[ds[rid]]["flats"]:7}  частных {izhs:6}  {by}')
    json.dump(out, open(ROOT / 'osm_districts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
