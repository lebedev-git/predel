# Вход единой модели (src/model/forecast.ts) для района Казани → public/data/<файл>.
# Запуск из рабочей папки C:/tmp/kzn:  python <репозиторий>/pipeline/kzn/forecast_input.py sovetsky Советский azino-forecast.json
#   закрепление домов — kazan.fulledu.ru/shkola-po-propiske/<район>/ (адреса по постановлению ИКМО о закреплении), кэш <район>/pages/;
#   дома — OSM, выгрузка C:/tmp/demo/kzn/goroda/tatarstan.osm.pbf (квартиры building:flats, частный дом = 1 квартира,
#     год ввода start_date / building:year, центр контура), кэш <район>/osm.json;
#   школы — kazan_schools.json (ИНН, координаты, факт учеников edu.tatar.ru на 01.10.2026);
#     год открытия и проектная мощность новых школ — inputs/new_schools_capacity.json (цитаты новостей);
#   ученики 2016–2025 — госзадания bus.gov.ru (план на год, nsav/bus_city.json), 2026 — факт edu.tatar.ru.
# Квартиры дома за двумя школами делятся пополам. Прогимназии (только 1–4 классы) не берём: модель считает детей 7–17.
import html, json, pathlib, re, subprocess, sys, time

D, NAME, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
REPO = pathlib.Path(__file__).resolve().parents[2]
WORK = pathlib.Path(D); (WORK / 'pages').mkdir(parents=True, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'

def get(url, path):
    if not path.exists():
        path.write_bytes(subprocess.run(['curl', '-s', '--noproxy', '*', '--max-time', '30', '-A', UA, url], capture_output=True).stdout); time.sleep(0.3)
    return path.read_text(encoding='utf-8', errors='ignore')

# --- закрепление (как parse2.py) ---
BASE = f'https://kazan.fulledu.ru/shkola-po-propiske/{D}/'
slugs = sorted(set(re.findall(rf'shkola-po-propiske/{D}/([a-z0-9-]+)/', get(BASE, WORK / 'list.html'))))
NUM = re.compile(r'(\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?)\s*(?:\(([^)]*)\))?')
C = {}
for slug in slugs:
    h = get(BASE + slug + '/', WORK / 'pages' / f'{slug}.html')
    title = html.unescape((re.search(r'<title>([^<]*)', h) or [None, ''])[1])
    houses, full = [], []
    # полный список — в разметке: <li> на улицу, дома — кнопки «Показать на карте»; в JSON-LD страницы только первые 100 адресов
    for li in re.findall(r'<li class="px-4 py-2">(.*?)</li>', h.replace('<!-- -->', ''), re.S):
        street = html.unescape((re.search(r'<span class="font-semibold">(.*?)</span>', li) or [None, ''])[1]).strip()
        rest = ', '.join(html.unescape(x) for x in re.findall(r'title="Показать на карте"[^>]*>([^<]*)</button>', li))
        if not street: continue
        if not rest or re.search(r'все дома|вся улица|полностью', street):
            full.append(re.sub(r'\s*—\s*все дома.*', '', street)); continue
        for m in NUM.finditer(rest):
            ks = re.findall(r'(?:корп\.?|к\.?)\s*(\d+)', m.group(2)) if m.group(2) else []
            if m.group(2) and not ks: ks = re.findall(r'(\d+)', m.group(2))
            houses.append((street.strip(), m.group(1), ks))
    C[slug] = {'title': title, 'houses': houses, 'full': full}

# --- школы ---
rows = [r for r in json.load(open('kazan_schools.json', encoding='utf-8')) if r['район'] == NAME and r['тип'] == 'школа']
num = lambda s: (re.search(r'№\s?(\d+)', s) or [None, None])[1]
NEW = {}
for x in json.load(open(REPO / 'pipeline/inputs/new_schools_capacity.json', encoding='utf-8')):
    if x['district'] == NAME and isinstance(x['number'], int) and x['opened']: NEW.setdefault(x['number'], []).append(x)
def pick(slug):  # одна строка реестра на школу: по номеру, тип по заголовку закрепления (гимназия № 11 / лицей № 11)
    n, t = re.search(r'shkola-(\d+)', slug).group(1), C[slug]['title'].lower()
    cand = [r for r in rows if num(r['название']) == n and 'интернат' not in r['название'].lower()]
    kind = lambda r: [k for k in ('гимназ', 'лице', 'школ', 'сош', 'оош') if k in r['название'].lower()][:1]
    best = [r for r in cand if kind(r) and kind(r)[0] in t] or cand
    return best[0] if best else None
schools, skipped_schools = [], []
for slug in slugs:
    r = pick(slug)
    if not r or 'прогимназ' in r['название'].lower(): skipped_schools.append(slug); continue
    n = int(num(r['название'])); nm = r['название'].lower()
    first = [x for x in NEW.get(n, []) if x['capacity']]
    opened = min((x['opened'] for x in first), default=None)
    # новое здание старой школы (№ 11, 79, 93, 95, 123) — не открытие: школа была и раньше, по истории госзаданий
    hist = json.load(open('nsav/bus_city.json', encoding='utf-8')).get(r['ИНН'], {}).get('years', {})
    early = [int(y) for y, v in hist.items() if v and opened and int(y) < opened]
    sc = {'id': slug, 'name': ('Гимназия' if 'гимназ' in nm else 'Лицей' if 'лице' in nm else 'Школа') + f' № {n}', 'inn': r['ИНН'],
          'coords': [float(r['долгота']), float(r['широта'])], 'openYear': opened if opened and not early else 1960,
          'magnet': 'гимназ' in nm or 'лице' in nm}
    if first: sc['design'] = sum(x['capacity'] for x in first)
    schools.append(sc)

# --- дома OSM из выгрузки ---
lon = [s['coords'][0] for s in schools]; lat = [s['coords'][1] for s in schools]
BB = (min(lat) - 0.03, min(lon) - 0.05, max(lat) + 0.03, max(lon) + 0.05)
osm_path = WORK / 'osm.json'
if not osm_path.exists():
    import osmium
    out = []
    for w in osmium.FileProcessor('C:/tmp/demo/kzn/goroda/tatarstan.osm.pbf').with_locations().with_filter(osmium.filter.KeyFilter('building')):
        if not w.is_way() or 'addr:street' not in w.tags or 'addr:housenumber' not in w.tags: continue
        pts = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
        if not pts: continue
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if not (BB[0] <= cy <= BB[2] and BB[1] <= cx <= BB[3]): continue
        t = dict(w.tags)
        kx, ky = 111320 * 0.5625, 110540  # м на градус у Казани (cos 55,8° ≈ 0,5625)
        area = abs(sum((p[0] - q[0]) * kx * (p[1] + q[1]) * ky for p, q in zip(pts, pts[1:] + pts[:1]))) / 2
        out.append([w.id, t['addr:street'], t['addr:housenumber'], t.get('building:flats', ''), t['building'],
                    t.get('start_date') or t.get('building:year') or '', round(cx, 6), round(cy, 6), t.get('building:levels', ''), round(area)])
    osm_path.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
OSM = json.loads(osm_path.read_text(encoding='utf-8'))

# --- сопоставление адресов (как yield2.py) ---
TYPEW = r'\b(ул|улица|пер|переулок|пр|пр-т|проспект|б-р|бульвар|проезд|пр-д|ш|шоссе|тракт|пл|площадь)\b\.?'
def toks(s):
    s = s.lower().replace('ё', 'е'); s = re.sub(TYPEW, ' ', s); s = re.sub(r'[^\w\s-]', ' ', s)
    return frozenset(w for w in s.split() if len(w) > 1 or w.isdigit())
hn = lambda h: h.lower().replace(' ', '').replace('корпус', 'к').replace('корп.', 'к').replace('к.', 'к')
IZHS = {'house', 'detached', 'semidetached_house'}
# многоквартирный дом без building:flats (так почти у всех новостроек) — квартиры по площади этажей: 0,0129 кв. на м²
# контура × этаж (медиана по 2 838 домам Советского района с указанными квартирами, квартили 0,0096–0,0157)
FLATS_PER_M2 = 0.0129
by_street, info, estimated = {}, {}, 0
for oid, st, hnum, fl, kind, yr, cx, cy, lv, area in OSM:
    f = int(fl) if fl.isdigit() else 1 if kind in IZHS else 0
    if not f and kind in ('apartments', 'residential', 'dormitory') and lv.isdigit() and int(lv) >= 3:
        f = round(area * int(lv) * FLATS_PER_M2); estimated += 1
    m = re.search(r'(19\d\d|20[0-3]\d)', yr)
    info[oid] = (f, int(m.group(1)) if m else None, cx, cy)
    by_street.setdefault(toks(st), []).append((hn(hnum), oid))
streets = list(by_street)
sts = lambda name: [s for s in streets if toks(name) and toks(name) <= s]
assign, miss = {}, {}
for slug, c in C.items():
    for st, n, ks in c['houses']:
        n = hn(n); hits = []
        for s in sts(st):
            for h, oid in by_street[s]:
                if (ks and h in [n + 'к' + k for k in ks]) or (not ks and (h == n or re.fullmatch(re.escape(n) + r'к\d+', h))): hits.append(oid)
            if ks and not hits: hits += [oid for h, oid in by_street[s] if h == n]
        if not hits: miss[slug] = miss.get(slug, 0) + 1
        for oid in hits: assign.setdefault(oid, set()).add(slug)
    for st in c['full']:
        ss = sts(st)
        if not ss: miss[slug] = miss.get(slug, 0) + 1
        for s in ss:
            for _, oid in by_street[s]: assign.setdefault(oid, set()).add(slug)

ids = {s['id'] for s in schools}
houses, stat = [], {'без квартир': 0, 'без года (считаем старым)': 0}
for oid, sl in assign.items():
    sl = sorted(s for s in sl if s in ids)
    f, y, cx, cy = info[oid]
    if not f or not sl: stat['без квартир'] += not f; continue
    if y is None: stat['без года (считаем старым)'] += 1
    for s in sl: houses.append([f'{oid}:{s}', cx, cy, round(f / len(sl), 1), y or 1980, s, None])

# --- ученики по годам ---
BUS = json.load(open('nsav/bus_city.json', encoding='utf-8'))
fact26 = {r['ИНН']: r['учеников 2026'] for r in rows if r.get('учеников 2026')}
observed, outliers = {}, []
for sc in schools:
    ys = {int(y): v for y, v in BUS.get(sc['inn'], {}).get('years', {}).items() if v and int(y) < 2026 and int(y) >= sc['openYear']}
    for y in [y for y in ys if y - 1 in ys and y + 1 in ys]:  # одиночный скачок плана в 1,4 раза от обоих соседей — выброс
        if ys[y] > 1.4 * max(ys[y - 1], ys[y + 1]) or ys[y] < min(ys[y - 1], ys[y + 1]) / 1.4: outliers.append(f"{sc['id']} {y}: {ys[y]}")
    ys = {y: v for y, v in ys.items() if f"{sc['id']} {y}: {v}" not in outliers}
    if fact26.get(sc['inn']): ys[2026] = fact26[sc['inn']]
    # несогласованный ряд старой школы — госзадание покрывает часть программ (№ 108: план 50, факт 302) или школу
    # объединили (№ 15: 207 → 611 за год): в сверку не берём, в модели школа остаётся
    k = sorted(ys)
    jumps = [max(ys[a], ys[b]) / min(ys[a], ys[b]) for a, b in zip(k, k[1:])]
    if sc['openYear'] == 1960 and jumps and max(jumps) > 1.6: outliers.append(f"{sc['id']}: ряд несогласован, скачок в {max(jumps):.1f} раза"); ys = {}
    observed[sc['id']] = dict(sorted(ys.items()))
for sc in schools: del sc['inn']

json.dump({'district': f'{NAME} район', 'houses': houses, 'schools': schools, 'observed': observed,
           'columns': ['id', 'lon', 'lat', 'flats', 'year', 'school', 'prev'],
           'notes': {'skipped': stat, 'flatsEstimated': estimated, 'outliers': outliers, 'skippedSchools': skipped_schools, 'missAddr': miss},
           'sources': ['закрепление домов — kazan.fulledu.ru/shkola-po-propiske (по постановлению ИКМО г. Казани о закреплении)',
                       'квартиры, год ввода, контуры — OpenStreetMap (выгрузка 01.10.2026); частный дом — 1 квартира; дом без года ввода считается старым',
                       'год открытия и мощность новых школ — новости мэрии и СМИ (pipeline/inputs/new_schools_capacity.json)',
                       'ученики 2016–2025 — госзадания bus.gov.ru (план на год), 2026 — edu.tatar.ru, 01.10.2026']},
          open(REPO / 'public/data' / OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('школ', len(schools), 'пропущены', skipped_schools, '| домов', len(houses), 'кв.', round(sum(h[3] for h in houses)), '|', stat, '| квартиры по площади:', estimated)
print('новые дома: после 2010', round(sum(h[3] for h in houses if h[4] > 2010)), 'кв., после 2015', round(sum(h[3] for h in houses if h[4] > 2015)), 'кв.')
print('не найдено адресов:', sum(miss.values()), 'выбросы', outliers)
for sc in schools: print(f"  {sc['name']:15} {'гимн/лиц' if sc['magnet'] else '':8} откр {sc['openYear']} мест {sc.get('design', '')}  {observed[sc['id']]}")
