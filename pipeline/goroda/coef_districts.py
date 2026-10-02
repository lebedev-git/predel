# Коэффициенты по 7 районам Казани → coef_districts.json:
#   дети 7–17 на квартиру МКД — Татарстанстат (ВПС на 01.01.2024) / квартиры OSM — все районы;
#   учеников на квартиру — сумма учеников школ района (edu.tatar.ru, 01.10.2026) / квартиры OSM — где есть выгрузка.
import json, pathlib, sys, os

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT.parent)); os.chdir(ROOT.parent)
from kazan import docx_areas

a24 = docx_areas('vps2024.docx')
osm = json.load(open(ROOT / 'osm_districts.json', encoding='utf-8'))
rows = json.load(open('C:/tmp/kzn/edu_tatar_contingent.json', encoding='utf-8'))['rows']  # все 7 районов, scrape_edu.py 01.10.2026
EDU = {'sovetcki': 'Советский район', 'priv': 'Приволжский район', 'nsav': 'Ново-Савиновский район', 'aviastroit': 'Авиастроительный район',
       'moskow': 'Московский район', 'kirov': 'Кировский район', 'vahit': 'Вахитовский район'}
pupils, schools, nodata = {}, {}, {}
for r in rows:
    if r['type'] != 'school': continue
    d = EDU[r['district']]
    schools[d] = schools.get(d, 0) + 1
    if r.get('students'): pupils[d] = pupils.get(d, 0) + r['students']
    else: nodata[d] = nodata.get(d, 0) + 1

out = {}
for name, o in sorted(osm.items()):
    kids = sum(a24[name][a][0] for a in range(7, 18))
    young = sum(v for k, v in o['by_year'].items() if k in ('2010–2016', '2017–2026'))
    out[name] = {'flats': o['flats'], 'izhs': o['izhs'], 'kids_7_17': kids, 'kids_per_flat': round(kids / o['flats'], 3),
                 'kids_per_home': round(kids / (o['flats'] + o['izhs']), 3),  # с частными домами
                 'young_share': round(young / o['flats'], 3), 'pupils_2026': pupils.get(name), 'schools': schools.get(name), 'schools_nodata': nodata.get(name, 0),
                 'pupils_to_kids': round(pupils[name] / kids, 3) if name in pupils else None,
                 'pupils_per_flat': round(pupils[name] / o['flats'], 3) if name in pupils else None}
city = {'flats': sum(v['flats'] for v in out.values()), 'izhs': sum(v['izhs'] for v in out.values()), 'kids_7_17': sum(v['kids_7_17'] for v in out.values())}
city['kids_per_home'] = round(city['kids_7_17'] / (city['flats'] + city['izhs']), 3)
city['kids_per_flat'] = round(city['kids_7_17'] / city['flats'], 3)
json.dump({'districts': out, 'city': city, 'sources': ['дети 7–17 — Татарстанстат, население по однолетним возрастам на 01.01.2024 (ВПС-2024)',
           'квартиры — OpenStreetMap, дома с building:flats ≥ 4', 'ученики — edu.tatar.ru, визитные карточки школ, 01.10.2026']},
          open(ROOT / 'coef_districts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{"район":26} {"квартир":>8} {"частных":>7} {"дети 7–17":>9} {"на кв.":>6} {"+частные":>8} {"новые с 2010":>12} {"учеников":>8} {"на кв.":>6}')
for n, v in sorted(out.items(), key=lambda kv: -kv[1]['kids_per_flat']):
    print(f'{n:26} {v["flats"]:8,} {v["izhs"]:7,} {v["kids_7_17"]:9,} {v["kids_per_flat"]:6.2f} {v["kids_per_home"]:8.2f} {v["young_share"]:12.0%} {v["pupils_2026"] or "—":>8} {v["pupils_per_flat"] or "—":>6}')
for n, v in sorted(out.items(), key=lambda kv: -(kv[1]['pupils_to_kids'] or 0)):
    print(f'  {n:26} школ {v["schools"]:3} (без числа {v["schools_nodata"]}) учеников {v["pupils_2026"]:7,} детей 7–17 {v["kids_7_17"]:7,} → учатся в районе {v["pupils_to_kids"]:.0%}')
print(f'  всего школ {sum(schools.values())}, учеников {sum(pupils.values()):,}')
print(f'{"Казань":26} {city["flats"]:8,} {city["izhs"]:7,} {city["kids_7_17"]:9,} {city["kids_per_flat"]:6.2f} {city["kids_per_home"]:8.2f}')
