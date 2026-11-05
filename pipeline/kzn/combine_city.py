# Вход единой модели по всей Казани → public/data/kazan-forecast.json: дома, школы и ученики 7 районов в одном файле,
# чтобы дети распределялись по школам через границы районов (в школах Вахитовского района учится в 1,55 раза больше
# детей, чем в нём живёт). Запуск из C:/tmp/kzn после forecast_input.py по каждому району (см. pipeline/README.md):
#   for d in aviastroitelny:Авиастроительный ... : python forecast_input.py <d> <Район> C:/tmp/kzn/city/<d>.json
import json, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
D = ['aviastroitelny', 'vakhitovsky', 'kirovsky', 'moskovsky', 'novo-savinovsky', 'privolzhsky', 'sovetsky']
out = {'district': 'Казань', 'houses': [], 'schools': [], 'observed': {}, 'notes': {}, 'sources': None}
for d in D:
    x = json.load(open(f'city/{d}.json', encoding='utf-8'))
    for s in x['schools']: s['district'] = x['district']
    out['houses'] += x['houses']; out['schools'] += x['schools']; out['observed'].update(x['observed'])
    out['notes'][x['district']] = x['notes']; out['sources'] = x['sources']; out['columns'] = x['columns']
ids = [s['id'] for s in out['schools']]
assert len(ids) == len(set(ids)), 'одна школа в двух районах'

# --- стройки из реестра Госстройнадзора РТ (pipeline/goroda/gsn_layer.py → gsn/objects.json): нагрузят школы после сдачи.
# Квартиры указаны у 10 из 132 объектов, остальным — 320 (середина диапазона 250–400 из gsn_forecast.py); сдача — год
# разрешения + 1 (как там же); закрепление — ближайшая школа, открытая к сдаче. Дом, который уже есть в OSM рядом
# (до 40 м, сдан не раньше чем за год до срока), пропускаем, чтобы не посчитать дважды.
GSN = json.load(open('C:/tmp/demo/kzn/goroda/gsn/objects.json', encoding='utf-8'))['objects']
km = lambda a, b: (((a[0] - b[0]) * 62.6) ** 2 + ((a[1] - b[1]) * 111.2) ** 2) ** 0.5
new_osm = [h for h in out['houses'] if h[4] >= 2024]
added, est, skipped = 0, 0, 0
for o in GSN:
    if not o.get('ll') or not o.get('district'): continue
    year = o['T'] + 1
    if any(km((h[1], h[2]), o['ll']) < 0.04 and h[4] >= year - 1 for h in new_osm): skipped += 1; continue
    flats = o.get('flats') or 320; est += not o.get('flats')
    near = min((s for s in out['schools'] if s['openYear'] <= year), key=lambda s: km(s['coords'], o['ll']))
    out['houses'].append([f"gsn:{o['id']}", round(o['ll'][0], 6), round(o['ll'][1], 6), flats, year, near['id'], None]); added += 1
out['notes']['стройки ГСН'] = {'добавлено': added, 'квартиры по умолчанию 320': est, 'уже в OSM': skipped, 'реестр': 'registry_2026-09-25.xlsx'}
json.dump(out, open(REPO / 'public/data/kazan-forecast.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('стройки ГСН:', out['notes']['стройки ГСН'])
print('школ', len(out['schools']), 'домов', len(out['houses']), 'квартир', round(sum(h[3] for h in out['houses'])),
      'с историей', sum(1 for v in out['observed'].values() if v))
