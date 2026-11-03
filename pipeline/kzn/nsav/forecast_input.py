# Вход единой модели (src/model/forecast.ts) по Ново-Савиновскому району → public/data/nsav-forecast.json.
# Запуск из рабочей папки C:/tmp/kzn/nsav:  python <репозиторий>/pipeline/kzn/nsav/forecast_input.py
#   дома — закрепление по постановлению ИКМО № 791 от 16.03.2026 (разбор yield2.py), квартиры и год ввода — OSM;
#     дома гимназии № 107 до её открытия (2023) были закреплены за школой № 143 — постановление № 735 от 14.03.2022;
#   школы — координаты из public/data/kazan-nsav.json, гимназия/лицей — по названию в постановлении;
#   ученики — госзадания bus.gov.ru 2020–2025 (план на год), edu.tatar.ru 01.10.2026 (факт).
import json, pathlib, re

REPO = pathlib.Path(__file__).resolve().parents[3]
g = {}; exec(open('yield2.py', encoding='utf-8').read().split('rows = []')[0], g)  # C, E, assign (OSM id → школы), info, miss
C, E, assign, info = g['C'], g['E'], g['assign'], g['info']
EL = {e['id']: e for e in E}
DROP = {'shkola-360-kzn'}  # прогимназия: только 1–4 классы, модель считает детей 7–17 лет

def year(e):
    t = e.get('tags', {})
    m = re.search(r'(19\d\d|20[0-3]\d)', str(t.get('start_date') or t.get('building:year') or ''))
    return int(m.group(1)) if m else None

houses, skipped = [], {'без квартир': 0, 'без года (считаем старым)': 0}
for i, slugs in assign.items():
    slugs = sorted(s for s in slugs if s not in DROP)
    flats, e = info[i][1], EL[i]
    if not flats or info[i][2] not in ('apartments', 'residential', 'yes', 'dormitory'): skipped['без квартир'] += 1; continue
    y = year(e)
    if y is None: skipped['без года (считаем старым)'] += 1
    b = e['bounds']; lon, lat = round((b['minlon'] + b['maxlon']) / 2, 6), round((b['minlat'] + b['maxlat']) / 2, 6)
    for s in slugs or [None]:  # дом за двумя школами — квартиры пополам
        houses.append([f'{i}:{s}', lon, lat, round(flats / max(1, len(slugs)), 1), y or 1980, s, 'shkola-143-kzn' if s == 'shkola-107-kzn' else None])

KD = json.load(open(REPO / 'public/data/kazan-nsav.json', encoding='utf-8'))
num = lambda s: (re.search(r'№\s?(\d+)', s) or [None, None])[1]
coords = {}
for o in KD['objects']:
    if o['kind'] == 'school' and num(o['name']) and 'интернат' not in o['name'].lower(): coords.setdefault(num(o['name']), o['coords'])
schools, nocoord = [], []
for slug, c in C.items():
    if slug in DROP: continue
    n = re.search(r'shkola-(\d+)', slug).group(1)
    if n not in coords: nocoord.append(slug); continue
    t = c['title'].lower()
    sc = {'id': slug, 'name': ('Гимназия' if 'гимназ' in t else 'Лицей' if 'лице' in t else 'Школа') + f' № {n}', 'coords': coords[n],
          'openYear': 2023 if slug == 'shkola-107-kzn' else 1960, 'magnet': 'гимназ' in t or 'лице' in t}
    if slug == 'shkola-107-kzn': sc['design'] = 1224  # urban-media.ru, business-gazeta.ru
    schools.append(sc)

A = json.load(open('bus_all.json', encoding='utf-8'))['school']
G7 = next(o for o in json.load(open('C:/tmp/demo/kzn/goroda/map/charts.json', encoding='utf-8'))['orgs'] if o['inn'] == '1657027346')
A['shkola-7-kzn'] = {'years': {y: v for y, v in G7['years'].items() if y != '2026'}}  # в bus_all.json под слагом — лицей-интернат № 7 (см. nsav_history.py)
EDU = {num(x['name']): x['students'] for x in json.load(open('C:/tmp/kzn/edu_tatar_nsav.json', encoding='utf-8'))['rows']
       if x['type'] == 'school' and num(x['name']) and 'интернат' not in x['name'] and 'Адымнар' not in x['name']}
observed, outliers = {}, []
for sc in schools:
    ys = {int(y): v for y, v in A.get(sc['id'], {'years': {}})['years'].items() if v}
    n = re.search(r'shkola-(\d+)', sc['id']).group(1)
    for y in [y for y in ys if y - 1 in ys and y + 1 in ys]:  # одиночный скачок плана в 1,4 раза от обоих соседей — выброс
        if ys[y] > 1.4 * max(ys[y - 1], ys[y + 1]) or ys[y] < min(ys[y - 1], ys[y + 1]) / 1.4: outliers.append(f"{sc['id']} {y}: {ys[y]}")
    ys = {y: v for y, v in ys.items() if f"{sc['id']} {y}: {v}" not in outliers}
    if EDU.get(n): ys[2026] = EDU[n]
    observed[sc['id']] = dict(sorted(ys.items()))

out = {
    'district': 'Ново-Савиновский район', 'houses': houses, 'schools': schools, 'observed': observed,
    'columns': ['id', 'lon', 'lat', 'flats', 'year', 'school', 'prev'],
    'notes': {'skipped': skipped, 'outliers': outliers, 'nocoord': nocoord, 'dropped': sorted(DROP), 'missOSM': {k: len(v) for k, v in g['miss'].items() if v}},
    'sources': ['закрепление домов — постановление ИКМО г. Казани № 791 от 16.03.2026; до открытия гимназии № 107 — № 735 от 14.03.2022',
                'квартиры, год ввода, контуры — OpenStreetMap; дом без года ввода считается старым',
                'ученики 2020–2025 — госзадания bus.gov.ru (план на год), 2026 — edu.tatar.ru, 01.10.2026'],
}
json.dump(out, open(REPO / 'public/data/nsav-forecast.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('домов', len(houses), 'квартир', round(sum(h[3] for h in houses)), '| школ', len(schools), '| пропущено', skipped, '| без координат', nocoord)
print('выбросы', outliers)
print('годы ввода после 2015:', sum(1 for h in houses if h[4] > 2015), 'домов,', round(sum(h[3] for h in houses if h[4] > 2015)), 'кв.')
for sc in schools: print(f"  {sc['name']:16} {'гимн/лиц' if sc['magnet'] else '':8} {observed[sc['id']]}")
