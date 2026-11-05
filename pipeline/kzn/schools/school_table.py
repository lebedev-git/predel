# Таблица школ Казани для калькулятора и модели → public/data/kazan-schools.json.
# Запуск из C:/tmp/kzn после capacity_scan.py, wayback_pupils.py, bus_fact.py (см. pipeline/README.md).
#
# Мощность, по убыванию надёжности:
#   1) проект из новостей мэрии (capacity_all.json, source=проект: 17 новых школ);
#   2) сама школа на своих страницах edu.tatar.ru (capscan/result.json: «проектная мощность … N», «рассчитана на N»);
#   3) площадь этажей OSM ÷ м² на место по эпохе основания школы (калибровка на школах из 1–2, год основания —
#      карточка edu.tatar.ru); диапазон — квартили эпохи. Оценке не доверяем, если по ней школа больше чем в двух
#      сменах: в OSM обрисована часть здания или нет этажности → «нет данных».
# Ученики по годам, по убыванию надёжности: отчёт об исполнении муниципального задания (bus.gov.ru, факт) > архив
#   карточки edu.tatar.ru (web.archive.org) > план госзадания; 2026 — карточка edu.tatar.ru на 01.10.2026.
import json, pathlib, re, statistics as st, time, urllib.request

REPO = pathlib.Path(__file__).resolve().parents[3]
S = [r for r in json.load(open('kazan_schools.json', encoding='utf-8')) if r['тип'] == 'школа']
OSM = {x['name']: x for x in json.load(open('osm_capacity.json', encoding='utf-8'))['schools']}
CAP = json.load(open('capacity_all.json', encoding='utf-8'))['orgs']
SCAN = {x['inn']: x for x in json.load(open('capscan/result.json', encoding='utf-8'))}
WB = json.load(open('wayback/facts.json', encoding='utf-8'))
BUS = json.load(open('busfact/facts.json', encoding='utf-8'))

# --- год основания с карточки edu.tatar.ru (кэш capscan/founded.json) ---
fpath = pathlib.Path('capscan/founded.json')
FOUND = json.loads(fpath.read_text(encoding='utf-8')) if fpath.exists() else {}
for r in S:
    if r['ИНН'] in FOUND or not r.get('edu.tatar'): continue
    try:
        h = urllib.request.urlopen(urllib.request.Request(r['edu.tatar'], headers={'User-Agent': 'Mozilla/5.0'}), timeout=40).read().decode('utf-8', 'ignore')
        m = re.search(r'Год основания учреждения:\s*(\d{4})', re.sub(r'<[^>]+>', ' ', h)); FOUND[r['ИНН']] = int(m.group(1)) if m else None
        time.sleep(0.3)
    except Exception: FOUND[r['ИНН']] = None
fpath.write_text(json.dumps(FOUND), encoding='utf-8')

def stated(inn):  # мощность, которую школа сама пишет на своих страницах
    for _, _, t in (SCAN.get(inn) or {}).get('hits', []):
        if not re.search(r'проектн|рассчитан', t, re.I): continue
        for n in re.findall(r'\d[\d \u00a0]{1,6}', t):
            v = int(re.sub(r'\D', '', n))
            if 100 <= v <= 4000: return v

def exact(r):
    c = CAP.get(r['ИНН'])
    if c and c['source'] == 'проект': return c['capacity'], 'проект (новости мэрии)'
    v = stated(r['ИНН'])
    return (v, 'сайт школы') if v else (None, None)

era = lambda y: 'до 1990' if y < 1990 else ('1990-2007' if y < 2008 else 'с 2008')
cal = []
for r in S:
    cap, src = exact(r); o = OSM.get(r['название']) or {}; y = FOUND.get(r['ИНН'])
    if cap and o.get('floor_m2') and y: cal.append({'inn': r['ИНН'], 'k': o['floor_m2'] / cap, 'era': era(y), 'floor': o['floor_m2'], 'cap': cap})
K = {e: [x['k'] for x in cal if x['era'] == e] for e in ('до 1990', '1990-2007', 'с 2008')}
KQ = {e: (st.quantiles(v, n=4)[0], st.median(v), st.quantiles(v, n=4)[2]) for e, v in K.items()}
# проверка «без одной школы»
loo = [abs(x['floor'] / st.median([z['k'] for z in cal if z['era'] == x['era'] and z is not x]) / x['cap'] - 1) for x in cal]

rows = []
for r in S:
    inn = r['ИНН']; o = OSM.get(r['название']) or {}; y = FOUND.get(inn); n26 = r.get('учеников 2026')
    cap, src = exact(r); lo = hi = cap
    if not cap and o.get('floor_m2') and y:
        q = KQ[era(y)]; f = o['floor_m2']
        cap, lo, hi, src = round(f / q[1]), round(f / q[2]), round(f / q[0]), 'оценка по площади'
        if n26 and n26 > 2 * hi: cap = lo = hi = None; src = 'нет данных'  # площадь в OSM, похоже, неполная
    hist = {}
    for yy, v in (BUS.get(inn, {}).get('plan') or {}).items():
        if v: hist[int(yy)] = (v, 'план')
    for yy, v in (WB.get(inn, {}).get('years') or {}).items(): hist[int(yy)] = (v, 'архив')
    for yy, v in (BUS.get(inn, {}).get('years') or {}).items(): hist[int(yy)] = (v, 'отчёт')
    if n26: hist[2026] = (n26, 'карточка')
    rows.append({'inn': inn, 'name': r['название'], 'district': r['район'], 'coords': [float(r['долгота']), float(r['широта'])],
                 'founded': y, 'capacity': cap, 'capLo': lo, 'capHi': hi, 'capSource': src or 'нет данных',
                 'pupils': {str(k): v for k, (v, _) in sorted(hist.items())}, 'pupilsSource': {str(k): s for k, (_, s) in sorted(hist.items())}})

pf = [v['plan'][y] / v['years'][y] for v in BUS.values() for y in v['years'] if v['plan'].get(y) and v['years'][y] > 50]
wa = [WB[i]['years'][y] / BUS[i]['years'][y] for i in WB if i in BUS for y in WB[i]['years'] if y in BUS[i]['years'] and BUS[i]['years'][y] > 100]
meta = {
    'built': time.strftime('%Y-%m-%d'),
    'capacity': {'kByEra': {e: [round(x, 1) for x in q] for e, q in KQ.items()}, 'calibrationSchools': len(cal),
                 'looMedianError': round(st.median(loo), 3), 'looMeanError': round(st.mean(loo), 3), 'looMaxError': round(max(loo), 3)},
    'pupils': {'planToFactMedian': round(st.median(pf), 3), 'planToFactPairs': len(pf),
               'archiveToReportMedian': round(st.median(wa), 3), 'archiveToReportPairs': len(wa)},
    'sources': ['мощность: новости мэрии Казани, страницы школ на edu.tatar.ru, OpenStreetMap (площадь этажей), год основания — карточки edu.tatar.ru',
                'ученики: отчёты об исполнении муниципального задания и госзадания (bus.gov.ru), архив карточек edu.tatar.ru (web.archive.org), карточки edu.tatar.ru на 01.10.2026'],
}
json.dump({'meta': meta, 'schools': rows}, open(REPO / 'public/data/kazan-schools.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print('школ', len(rows), '| мощность', dict(Counter(x['capSource'] for x in rows)))
print('калибровка', meta['capacity']); print('ученики', meta['pupils'])
