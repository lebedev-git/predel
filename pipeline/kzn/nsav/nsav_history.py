# Данные для демо «Ново-Савиновский район: история и прогноз 2020–2036» → zastroyka/public/data/nsav-history.json.
# Вход: bus_all.json (госзадания bus.gov.ru), edu_tatar_nsav.json (факт 2026), закрепление домов (backtest.py), рождения Казани.
import json, math, re, statistics
exec(open('backtest.py', encoding='utf-8').read().split('# --- школы ---')[0])  # births, cohort, new_kids, C, assign, info, YIELD

A = json.load(open('bus_all.json', encoding='utf-8'))
# слаг shkola-7-kzn в bus_all.json указывал на лицей-интернат № 7 (ИНН 1657032924, ~240 учеников), а факт 2026 и закрепление — гимназии № 7 (ИНН 1657027346, 905):
# берём историю госзаданий гимназии (charts.json, все годы — госзадания, без оценок)
G7 = next(o for o in json.load(open('C:/tmp/demo/kzn/goroda/map/charts.json', encoding='utf-8'))['orgs'] if o['inn'] == '1657027346')
A['school']['shkola-7-kzn'] = {'inn': G7['inn'], 'years': {y: v for y, v in G7['years'].items() if y != '2026'}}
EDU = json.load(open('C:/tmp/kzn/edu_tatar_nsav.json', encoding='utf-8'))['rows']
num = lambda s: re.search(r'№\s?(\d+)', s).group(1) if re.search(r'№\s?(\d+)', s) else None
edu_s = {num(x['name']): x['students'] for x in EDU if x['type'] == 'school' and num(x['name']) and 'интернат' not in x['name'] and 'Адымнар' not in x['name']}
edu_k = {num(x['name']): x['students'] for x in EDU if x['type'] == 'kindergarten' and num(x['name'])}
YRS = list(range(2020, 2027)); BASE, FACT = 2021, 2026
SKIP = {'shkola-107-kzn', 'shkola-30-kzn'}  # нет истории до 2024 г. / закреплено 2 дома

def filled(ys):  # одиночный скачок плана (в 1,4 раза от обоих соседних лет) — выброс; пропуски — линейно, край — ближайшим годом (±1)
    raw = {y: v for y, v in ys.items() if v}
    k = dict(raw)
    for y in [y for y in raw if y - 1 in raw and y + 1 in raw and y not in (BASE, FACT)]:  # годы проверки не трогаем
        nb = (raw[y - 1], raw[y + 1])
        if raw[y] > 1.4 * max(nb) or raw[y] < min(nb) / 1.4: del k[y]
    out = {}
    for y in YRS:
        if y in k: out[y] = k[y]; continue
        lo = max((x for x in k if x < y), default=None); hi = min((x for x in k if x > y), default=None)
        if lo and hi: out[y] = k[lo] + (k[hi] - k[lo]) * (y - lo) / (hi - lo)
        elif lo and y - lo == 1: out[y] = k[lo]
        elif hi and hi - y == 1: out[y] = k[hi]
    return out

def panel(group, edu, a0, a1, with_new):
    inst = []
    for key, r in A[group].items():
        if group == 'school' and key in SKIP: continue
        n = re.search(r'shkola-(\d+)', key).group(1) if group == 'school' else num(key)
        ys = {int(y): v for y, v in r['years'].items() if v}
        if edu.get(n): ys[FACT] = edu[n]
        f = filled(ys)
        if BASE in f and FACT in f: inst.append((key, n, f, ys))
    fact = {y: (round(sum(f[y] for _, _, f, _ in inst)) if y >= BASE and all(y in f for _, _, f, _ in inst) else None) for y in YRS}  # 2020: у садов другой показатель
    gaps = {y: sum(1 for _, _, f, ys in inst if y not in ys) for y in YRS}
    newk = lambda y: sum(new_kids(k, BASE, y) for k, _, _, _ in inst) if with_new else 0
    back = {y: round(fact[BASE] * cohort(y, a0, a1, 'А') / cohort(BASE, a0, a1, 'А') + newk(y)) for y in range(BASE, FACT + 1)}
    fw, lo, hi = {}, {}, {}
    for y in range(FACT, 2037):
        base = cohort(FACT, a0, a1, 'А')
        unknown = [y - a for a in range(a0, a1 + 1) if y - a > 2024]  # дети ещё не родились — рождения по сценарию
        mid = cohort(y, a0, a1, 'А')
        d = sum(births(b, 'А') for b in unknown) * 0.10
        fw[y] = round(fact[FACT] * mid / base); lo[y] = round(fact[FACT] * (mid - d) / base); hi[y] = round(fact[FACT] * (mid + d) / base)
    err = (back[FACT] - fact[FACT]) / fact[FACT]; naive = (fact[BASE] - fact[FACT]) / fact[FACT]
    return inst, {'n': len(inst), 'fact': fact, 'gaps': gaps, 'back': back, 'forecast': fw, 'lo': lo, 'hi': hi, 'err': round(err, 4), 'naive': round(naive, 4)}

si, school = panel('school', edu_s, 7, 17, True)
ki, kg = panel('kg', edu_k, 1, 6, False)
rows = []
for key, n, f, ys in si:
    pred = f[BASE] * cohort(FACT, 7, 17, 'А') / cohort(BASE, 7, 17, 'А') + new_kids(key, BASE, FACT)
    mine = [i for i in assign if key in assign[i]]
    flats = sum(info[i][1] / len(assign[i]) for i in mine)
    t = C[key]['title'].lower()
    short = ('Прогимназия' if 'прогимназ' in t else 'Гимназия' if 'гимназ' in t else 'Лицей' if 'лице' in t else 'Школа') + f' № {n}'
    rows.append({'name': short, 'base': round(f[BASE]), 'fact': round(f[FACT]),
                 'pred': round(pred), 'err': round((pred - f[FACT]) / f[FACT], 3), 'flats': round(flats), 'yield': round(f[FACT] / flats, 2) if flats else None})
rows.sort(key=lambda r: abs(r['err']))
out = {
    'district': 'Ново-Савиновский район', 'base': BASE, 'factYear': FACT, 'yield': YIELD,
    'school': school, 'kg': kg, 'perSchool': rows,
    'sources': ['история учеников и воспитанников — госзадания на bus.gov.ru (план; медиана расхождения по школе 2%), 2020–2025; пропуски — интерполяция',
                'факт 2026 — edu.tatar.ru, визитные карточки, 01.10.2026',
                'закрепление домов — постановление ИКМО г. Казани № 791 от 16.03.2026; квартиры и год ввода — OpenStreetMap',
                'рождения Казани 2010–2024; до 2010 — как в 2010 г.; после 2024 — как в 2024 г. ±10% (диапазон)'],
    'excluded': 'гимназия № 107 — нет истории до 2024 г.; школа № 30 — 2 дома в закреплении. Прогимназия № 360 за период расширилась — по району учтены, по отдельной школе модель расширение не видит',
}
# --- Гимназия № 107 «Открытие»: точка — школа. Открыта 01.09.2023, проектная мощность 1 224 (urban-media.ru, business-gazeta.ru).
# Дома — закрепление по постановлению ИКМО № 791 (квартиры и год ввода — OSM); ученики — госзадания bus.gov.ru 2024–2025, edu.tatar.ru 2026.
import re as _re
src = open('yield2.py', encoding='utf-8').read().split('rows = []')[0]
g = {}; exec(src, g)  # assign (OSM id → школы), info (OSM id → номер дома, квартиры, тип), miss, E
YR = {}
for e in g['E']:
    m = _re.search(r'(19\d\d|20[0-3]\d)', str(e.get('tags', {}).get('start_date') or e.get('tags', {}).get('building:year') or ''))
    YR[e['id']] = int(m.group(1)) if m else 0
GEO = {e['id']: e.get('geometry') or next((m['geometry'] for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')), None) for e in g['E']}  # мультиполигон — внешний контур
KD = json.load(open('C:/Disk D/Project/Hacaton/zastroyka/public/data/kazan-nsav.json', encoding='utf-8'))
idx = {tuple(b[3][0]): i for i, b in enumerate(KD['buildings'])}
S107 = 'shkola-107-kzn'
mine = [i for i in g['assign'] if S107 in g['assign'][i]]
houses, bidx = [], []
for i in mine:
    houses.append([g['info'][i][1], YR[i]])
    geo = GEO.get(i) or []
    k = (round(geo[0]['lon'], 5), round(geo[0]['lat'], 5)) if geo else None
    if k in idx: bidx.append(idx[k]); continue
    if geo:  # контур в выгрузке округлён иначе — ближайшее здание по центру (до 20 м)
        cx, cy = sum(q['lon'] for q in geo) / len(geo), sum(q['lat'] for q in geo) / len(geo)
        dd, j = min(((abs(sum(p[0] for p in bb[3]) / len(bb[3]) - cx) * 62600) ** 2 + ((sum(p[1] for p in bb[3]) / len(bb[3]) - cy) * 111000) ** 2, j) for j, bb in enumerate(KD['buildings']) if abs(bb[3][0][1] - cy) < 0.002 and abs(bb[3][0][0] - cx) < 0.003)
        if dd < 400: bidx.append(j)
o107 = [o for o in KD['objects'] if o['kind'] == 'school' and '107' in o['name']][0]
ys107 = {int(y): v for y, v in A['school'][S107]['years'].items() if v}
ys107[FACT] = edu_s['107']
out['school107'] = {
    'name': 'Гимназия № 107 «Открытие»', 'coords': o107['coords'], 'opened': 2023, 'capacity': 1224,
    'fact': {y: ys107[y] for y in sorted(ys107) if y >= 2024}, 'houses': houses, 'buildings': sorted(set(bidx)),
    'addr': len(C[S107]['houses']) + len(C[S107]['full']), 'missing': g['miss'][S107],
    # до открытия: постановление ИКМО № 735 от 14.03.2022 — все эти адреса закреплены за школой № 143 (ул. Четаева, 1; 860 м)
    'related': {'sc107': 'дома закреплены с 2023 г.', 'sc143': 'дома закреплены до 2023 г. · 860 м'},  # школы этих домов — на карте фиолетовым, остальные серым
    'before': {'decree': 'постановление ИКМО № 735 от 14.03.2022', 'school': 'школой № 143', 'dist': 860, 'stud': A['school']['shkola-143-kzn']['years']['2022'],
               # мощность № 143 не опубликована; оценка по отчётам о самообследовании (2023–2025): 48 учебных кабинетов, одна смена → 48 × 25
               'capEst': 48 * 25},
    'yield': [YIELD, 0.30], 'flatM2': 50,
    'source': 'мощность 1 224 и открытие 01.09.2023 — urban-media.ru, business-gazeta.ru; закрепление — постановление ИКМО г. Казани № 791 от 16.03.2026, до открытия — № 735 от 14.03.2022 (kzn.ru); квартиры и год ввода — OpenStreetMap; ученики — госзадания bus.gov.ru (2024–2025), edu.tatar.ru (2026)',
}
# доступность по МНГП (500 м от школы) против закрепления: свои дома за кругом и чужие дома в круге — по зданиям на карте
_kx, _ky = 111320 * math.cos(math.radians(55.82)), 110540
_d = lambda r: math.hypot((sum(q[0] for q in r) / len(r) - o107['coords'][0]) * _kx, (sum(q[1] for q in r) / len(r) - o107['coords'][1]) * _ky)
_own = [(_d(KD['buildings'][i][3]), KD['buildings'][i][2]) for i in set(bidx)]
_oth = [b[2] for i, b in enumerate(KD['buildings']) if i not in set(bidx) and b[0] == 'res' and _d(b[3]) <= 500]
out['school107']['radius'] = {'r': 500, 'inside': sum(1 for x, _ in _own if x <= 500), 'outside': sum(1 for x, _ in _own if x > 500), 'outsideFlats': sum(f for x, f in _own if x > 500),
                               'far': round(max(x for x, _ in _own)), 'others': len(_oth), 'othersFlats': sum(_oth), 'mapped': len(_own)}
print('радиус:', out['school107']['radius'])
print('107:', len(houses), 'домов', sum(h[0] for h in houses), 'кв.', len(set(bidx)), 'зданий на карте', 'факт', out['school107']['fact'], 'нет в OSM', g['miss'][S107])
json.dump(out, open('C:/Disk D/Project/Hacaton/zastroyka/public/data/nsav-history.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for k in ('school', 'kg'):
    d = out[k]; print(k, 'учреждений', d['n'], '| факт', d['fact'], '| пропуски', d['gaps'])
    print('   прогноз из 2021:', d['back'], '| ошибка', d['err'], 'наивный', d['naive'])
    print('   до 2036:', d['forecast'], '\n   диапазон 2036:', d['lo'][2036], '–', d['hi'][2036])
