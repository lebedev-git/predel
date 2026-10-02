# Данные для графиков «школы / сады / район / год» → charts.json. Перезапускать по мере сбора bus_city.json.
# Город: ученики 2002–2026 + прогноз до 2036 (kazan_pupils.json); дети в садах, число школ и садов, ввод мест (сборник Росстата + БД ПМО).
# Районы и организации: госзадания bus.gov.ru по годам (план, ±2% к факту) + факт edu.tatar.ru на 01.10.2026; дети по возрастам (Татарстанстат, 01.01.2024).
import json, os, pathlib, statistics, sys
sys.path.insert(0, 'C:/tmp/kzn/nsav')
from bus_fill import fill  # 2022–2023: план из заданий прошлых лет, где сервер отдаёт 500
sys.path.insert(0, 'C:/tmp/demo/kzn/goroda')
import gsn_forecast as gf  # добавка детей от строек (реестр ГСН РТ)

HERE = pathlib.Path(__file__).parent
G = HERE.parent
sys.path.insert(0, 'C:/tmp/demo/kzn'); os.chdir('C:/tmp/demo/kzn')
from kazan import docx_areas, KZN_BIRTHS

I = lambda m: {int(k): v for k, v in m.items()}
city_p = json.load(open(G / 'kazan_pupils.json', encoding='utf-8'))
ser = json.load(open(G / 'kazan_series.json', encoding='utf-8'))['series']
bd = lambda pid: I(json.load(open(G / 'bdpmo' / f'{pid}.json', encoding='utf-8'))['data']) if (G / 'bdpmo' / f'{pid}.json').exists() else {}

# --- город
kg_children = {y: v * 1000 for y, v in I(ser['kg_children']).items() if y not in (2014, 2015, 2016)}  # 2014–2016 в сборнике со съехавшими столбцами
schools_n = {**I(ser['schools']), **{y: v for y, v in bd('8015001').items() if 2000 < y < 2030}}
kg_n = {**{y: v for y, v in bd('8014001').items() if 2000 < y < 2030}, 2002: 297}
city = {
    'pupils': {y: f['v'] for y, f in I(city_p['fact']).items()},
    'pupils_src': {y: f['src'] for y, f in I(city_p['fact']).items()},
    'forecast': I(city_p['forecast']),
    'kg_children': kg_children,
    'schools_n': schools_n, 'kg_n': kg_n,
    'school_places_built': I(ser['school_places_built']), 'kg_places_built': I(ser['kg_places_built']),
}

# --- организации: история по годам
orgs = json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8'))
bus = json.load(open('C:/tmp/kzn/nsav/bus_city.json', encoding='utf-8')) if os.path.exists('C:/tmp/kzn/nsav/bus_city.json') else {}

def clean(ys):  # выброс: меньше 0,6 или больше 1,6 медианы остальных лет (частичное госзадание) → нет данных
    v = {int(y): n for y, n in ys.items() if n}
    out = {}
    for y, n in v.items():
        rest = [m for x, m in v.items() if x != y]
        out[y] = n if not rest or 0.6 <= n / statistics.median(rest) <= 1.6 else None
    return {y: n for y, n in out.items() if n}

O = []
for o in orgs:
    rec = bus.get(o['ИНН'], {})
    filled, src = fill(rec, 'school' if o['тип'] == 'школа' else 'kg') if rec else ({}, {})
    ys = clean(filled)
    est = [y for y, s_ in src.items() if s_ != 'госзадание' and y in ys]
    ys.pop(2026, None)  # 2026 — факт edu.tatar, не план
    if o['учеников 2026']: ys[2026] = o['учеников 2026']
    O.append({'inn': o['ИНН'], 'name': o['название'], 'type': 'school' if o['тип'] == 'школа' else 'kg', 'district': o['район'],
              'form': o['форма'], 'years': dict(sorted(ys.items())), 'est': est, 'bus': o['ИНН'] in bus})

# --- районы: сумма по организациям за год + покрытие (доля детей 2026 у тех, у кого есть этот год)
a24 = docx_areas('vps2024.docx')
# дети 1–6 лет сдвигом возраста; кто на 01.01.2024 ещё не родился (возраст < 0) — рождения Казани
# (Татарстанстат до 2024 г., дальше уровень 2024 г.) × доля района среди детей до года
AGE0 = sum(a24[f'{d} район'][0][0] for d in {o['district'] for o in O if o['district']})
def kids_1_6(kids, y):
    k = y - 2024
    return round(sum(kids[a][0] if a >= 0 else KZN_BIRTHS.get(2023 - a, KZN_BIRTHS[2024]) * kids[0][0] / AGE0 for a in range(1 - k, 7 - k)))
D = {}
for d in sorted({o['district'] for o in O if o['district']}):
    kids = a24[f'{d} район']
    rec = {'kids_7_17': {2024 + k: sum(kids[a][0] for a in range(7 - k, 18 - k)) for k in range(0, 7)},  # 2024…2030 сдвигом возраста
           'kids_1_6': {y: kids_1_6(kids, y) for y in range(2024, 2031)}}
    for t in ('school', 'kg'):
        mine = [o for o in O if o['district'] == d and o['type'] == t]
        # цепной индекс: школы с данными и в году y, и в 2026 → их рост переносим на полную сумму района 2026 г.
        tot26 = sum(o['years'].get(2026, 0) for o in mine)
        def chained(y):
            S = [o for o in mine if y in o['years'] and 2026 in o['years']]
            base = sum(o['years'][2026] for o in S)
            return (round(sum(o['years'][y] for o in S) * tot26 / base) if base else 0), round(base / tot26, 2) if tot26 else 0, len(S)
        rec[t] = {}
        for y in range(2016, 2027):
            v, cov, k = chained(y)
            rec[t][y] = {'sum': v, 'cover': cov, 'n': k, 'raw': sum(o['years'][y] for o in mine if y in o['years'])}
        rec[t + '_count'] = len(mine)
    D[d] = rec

NEW = gf.component(gf.objects(), gf.levels_from(json.load(open(G / 'coef_districts.json', encoding='utf-8'))['districts']))
LV = gf.levels_from(json.load(open(G / 'coef_districts.json', encoding='utf-8'))['districts'])
import re as _re
GSN = [{'district': o['district'], 'T': o['T'], 'flats': o['flats'], 'dev': o['developer'], 'll': o['ll'],
        'name': (lambda m: m.group(1) if m else o['name'][:90])(_re.search(r'[«"]([^»"]{3,40})[»"]', o['name'])),
        'addr': o['addr'][:70], 'school_2030': round(gf.kids(o, 2030, 'school', LV[o['district']], 'mid')),
        'kg_2030': round(gf.kids(o, 2030, 'kg', LV[o['district']], 'mid'))} for o in gf.objects()]
json.dump({'city': city, 'districts': D, 'orgs': O, 'bus_done': len(bus), 'new': NEW, 'gsn': GSN,
           'sources': {'city': city_p['sources'], 'orgs': 'госзадания bus.gov.ru (план, совпадает с фактом ±2%) 2016–2025; факт edu.tatar.ru 01.10.2026',
                       'kids': 'Татарстанстат, население по однолетним возрастам на 01.01.2024; 2025–2030 — сдвиг возраста, без переездов'}},
          open(HERE / 'charts.json', 'w', encoding='utf-8'), ensure_ascii=False)
hist = sum(1 for o in O if len(o['years']) > 1)
print(f'организаций {len(O)}, с историей {hist}, bus.gov.ru опрошено {len(bus)}')
print('город: дети в садах', sorted(kg_children)[:3], '…', sorted(kg_children)[-2:], '| школ', schools_n, '| садов', kg_n)
