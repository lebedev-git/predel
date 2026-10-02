# Проверка прогноза «из прошлого» по Ново-Савиновскому району: стоим в базовом году (2020–2022), прогнозируем 2026 и сравниваем с фактом.
# Прогноз школы = ученики базового года × поправка на рождаемость + новые дома закрепления (ввод после базового года) × 0,24 × доля заселённых.
import json, re, statistics as st
from collections import defaultdict

YIELD, PACE = 0.24, [0.5, 0.8, 0.95, 1.0]
B = {2010: 14983, 2011: 16397, 2012: 17985, 2013: 18226, 2014: 18804, 2015: 20358, 2016: 21351, 2017: 18775,
     2018: 17566, 2019: 15760, 2020: 15264, 2021: 15810, 2022: 14725, 2023: 13640, 2024: 13227}
# до 2010: А — как в модели (постоянная 2010 г.); Б — оценка по коэффициентам рождаемости (2005: 9,3‰; 2008: +14,3% к 2007), тыс.
EARLY_B = {2003: 9800, 2004: 10000, 2005: 10400, 2006: 10800, 2007: 11500, 2008: 13100, 2009: 14000}
def births(y, variant):
    if y in B: return B[y]
    if y > 2024: return B[2024]
    return B[2010] if variant == 'А' else EARLY_B.get(y, 9800)
def cohort(year, a0, a1, variant): return sum(births(year - a, variant) for a in range(a0, a1 + 1))

# --- закрепление домов (как в yield2.py) ---
C = json.load(open('catchments2.json', encoding='utf-8'))
E = json.load(open('C:/tmp/kzn/osm_55.800_49.080_55.845_49.170.json', encoding='utf-8'))['elements']
TYPEW = r'\b(ул|улица|пер|переулок|пр|пр-т|проспект|б-р|бульвар|проезд|пр-д|ш|шоссе|тракт|пл|площадь)\b\.?'
def toks(s):
    s = s.lower().replace('ё', 'е'); s = re.sub(TYPEW, ' ', s); s = re.sub(r'[^\w\s-]', ' ', s)
    return frozenset(w for w in s.split() if len(w) > 1 or w.isdigit())
def hn(h): return h.lower().replace(' ', '').replace('корпус', 'к').replace('корп.', 'к').replace('к.', 'к')
osm = defaultdict(list)
for e in E:
    t = e.get('tags', {})
    if 'building' not in t or 'addr:street' not in t or e['type'] == 'node': continue
    fl = int(t['building:flats']) if t.get('building:flats', '').isdigit() else 0
    yr = int(t['start_date'][:4]) if re.match(r'\d{4}', t.get('start_date', '')) else None
    osm[toks(t['addr:street'])].append((hn(t.get('addr:housenumber', '')), fl, yr, e['id']))
streets = list(osm)
def sts(name):
    tk = toks(name); return [s for s in streets if tk and tk <= s]
assign, info = defaultdict(set), {}
for slug, c in C.items():
    for stt, n, ks in c['houses']:
        n = hn(n); hits = []
        for s in sts(stt):
            for b in osm[s]:
                if (ks and b[0] in [n + 'к' + k for k in ks]) or (not ks and (b[0] == n or re.fullmatch(re.escape(n) + r'к\d+', b[0]))): hits.append(b)
            if ks and not hits: hits += [b for b in osm[s] if b[0] == n]
        for b in hits: assign[b[3]].add(slug); info[b[3]] = b
    for stt in c['full']:
        for s in sts(stt):
            for b in osm[s]: assign[b[3]].add(slug); info[b[3]] = b
def new_kids(slug, base, target):  # дети из домов, сданных после базового года, к целевому году
    k = 0.0
    for i, sl in assign.items():
        if slug not in sl: continue
        _, fl, yr, _ = info[i]
        if fl and yr and base < yr <= target: k += fl / len(sl) * YIELD * PACE[min(target - yr, 3)]
    return k

# --- школы ---
H = json.load(open('bus_history.json', encoding='utf-8'))
EDU = {re.search(r'№\s?(\d+)', x['name']).group(1): x['students'] for x in json.load(open('C:/tmp/kzn/edu_tatar_nsav.json', encoding='utf-8'))['rows'] if x['type'] == 'school' and '№' in x['name'] and 'интернат' not in x['name'] and 'Адымнар' not in x['name']}
T = 2026
rows = []
for slug, h in H.items():
    ys = {int(k): v for k, v in h['years'].items() if v}
    base = next((y for y in (2021, 2020, 2022) if ys.get(y)), None)
    num = re.search(r'shkola-(\d+)', slug).group(1)
    fact = EDU.get(num) or ys.get(T)
    if not base or not fact: rows.append((slug, None)); continue
    r = {'школа': C[slug]['title'][23:60], 'база': base, 'было': ys[base], 'стало': fact, 'новые': round(new_kids(slug, base, T))}
    for v in ('А', 'Б'):
        f = cohort(T, 7, 17, v) / cohort(base, 7, 17, v)
        r['прогноз ' + v] = round(ys[base] * f + r['новые'])
    rows.append((slug, r))
ok = [r for _, r in rows if r]
err = lambda p, f: (p - f) / f * 100
print(f"{'школа':38} {'база':>4} {'было':>5} {'новые':>5} {'прогн А':>8} {'прогн Б':>8} {'факт':>5} | {'ош. А':>6} {'ош. Б':>6} {'наивн.':>6}")
for r in ok:
    print(f"{r['школа'][:38]:38} {r['база']:>4} {r['было']:>5} {r['новые']:>5} {r['прогноз А']:>8} {r['прогноз Б']:>8} {r['стало']:>5} | {err(r['прогноз А'], r['стало']):>+5.0f}% {err(r['прогноз Б'], r['стало']):>+5.0f}% {err(r['было'], r['стало']):>+5.0f}%")
print('без истории:', [s for s, r in rows if not r])
F = sum(r['стало'] for r in ok)
for k, name in (('прогноз А', 'модель, рождения до 2010 = 2010 г.'), ('прогноз Б', 'модель, рождения до 2010 — оценка'), ('было', 'наивный: как в базовом году')):
    tot = sum(r[k] for r in ok); med = st.median(abs(err(r[k], r['стало'])) for r in ok)
    print(f"{name:40}: район {err(tot, F):+.1f}% | медианная ошибка по школе {med:.0f}% | школ в пределах 15%: {sum(1 for r in ok if abs(err(r[k], r['стало'])) <= 15)} из {len(ok)}")
