# Стройки жилья Казани из реестра Инспекции ГСН РТ → gsn/objects.json: район, срок разрешения, квартиры (если указаны), координаты.
# Координаты — Nominatim по адресу (кэш gsn/geo.json, 1 запрос в секунду); район — из текста, иначе по кадастровому кварталу, иначе по точке.
import json, re, subprocess, time, urllib.parse, pathlib, collections, sys
import openpyxl

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from fetch_osm_districts import borders, inside

REG = sorted((HERE / 'gsn').glob('registry_*.xlsx'))[-1]
IDS = {2133461: 'Авиастроительный', 2133462: 'Вахитовский', 2133463: 'Кировский', 2133464: 'Московский',
       2133465: 'Ново-Савиновский', 2133466: 'Приволжский', 2133467: 'Советский'}
DN = r'(Авиастроительн|Вахитовск|Кировск|Московск|Ново-?Савиновск|Приволжск|Советск)'
NORM = {'Авиастроительн': 'Авиастроительный', 'Вахитовск': 'Вахитовский', 'Кировск': 'Кировский', 'Московск': 'Московский',
        'Ново-Савиновск': 'Ново-Савиновский', 'НовоСавиновск': 'Ново-Савиновский', 'Приволжск': 'Приволжский', 'Советск': 'Советский'}

def residential(t):
    t = (t or '').lower()
    if re.search(r'нежил', t) and not re.search(r'жилой дом|жилого дома|жилые дома|многоквартир|жилой комплекс|жилого комплекса', t): return False
    return bool(re.search(r'жилой дом|жилого дома|жилые дома|жилых домов|многоквартир|жилой комплекс|жилого комплекса|жилой квартал|жилого квартала|мкд', t)) \
        and not re.search(r'индивидуальн', t)

def address(t):  # «…; Республика Татарстан, г. Казань, Кировский р-н, ул. Шульгина, д. 17, кадастровый номер…» → «ул. Шульгина, д. 17»
    t = t or ''
    part = t.split(';', 1)[1] if ';' in t else t  # после «;» — адресная часть
    part = re.sub(r'(?i)республика татарстан(\s*\(татарстан\))?|\bРТ\b|г\.\s*Казань|\b\w+ский\s+(р-н|район)\b|\b(р-н|район)\s+\w+ский\b', ' ', part)
    a = re.split(r'(?i)кадастров|расположен|на земельном|земельн|в границах|\(\d', part)[0]
    a = re.sub(r'\s+', ' ', a).strip(' ,.')
    if not re.search(r'(?i)ул\.|улица|пр\.|просп|бульвар|б-р|пер\.|тракт|шоссе|мкр|микрорайон|жк|комплекс|массив', a):
        m = re.search(r'(?i)по\s+((?:ул\.|улице|пр\.|проспекту|бульвару)\s*[^,;]+)', t)  # «…по ул.Шульгина…» в названии
        a = m.group(1) if m else a
    return a

GEO_F = HERE / 'gsn' / 'geo.json'
GEO = json.load(open(GEO_F, encoding='utf-8')) if GEO_F.exists() else {}
def geocode(a):
    if not a: return None
    if a in GEO: return GEO[a]
    q = urllib.parse.urlencode({'q': f'{a}, Казань', 'format': 'json', 'limit': 1, 'countrycodes': 'ru',
                                'viewbox': '48.82,55.94,49.39,55.60', 'bounded': 1})
    r = subprocess.run(['curl', '-s', '-m', '30', '-A', 'zastroyka-hackathon/1.0', f'https://nominatim.openstreetmap.org/search?{q}'], capture_output=True)
    time.sleep(1.1)  # правила Nominatim: не чаще 1 запроса в секунду
    try: res = json.loads(r.stdout)
    except ValueError: res = []
    GEO[a] = [float(res[0]['lon']), float(res[0]['lat'])] if res else None
    json.dump(GEO, open(GEO_F, 'w', encoding='utf-8'), ensure_ascii=False)
    return GEO[a]

if __name__ == '__main__':
    ws = openpyxl.load_workbook(REG, read_only=True).worksheets[0]
    objs = []
    for r in ws.iter_rows(min_row=3, values_only=True):
        if not r[0] or not residential(r[1]) or not re.search(r'RU16-?301000|Казан', (r[2] or '') + (r[1] or '')): continue
        ys = [int(y) for y in re.findall(r'срок:\s*\d\d\.\d\d\.(20\d\d)', r[2] or '')]
        if not ys or max(ys) < 2025: continue  # просроченные до 2025 — не идущие стройки
        m, q = re.search(DN, r[1] or ''), re.search(r'16:50:(\d{2})', r[1] or '')
        fl = [int(x) for x in re.findall(r'(\d{2,4})\s*(?:-?ти)?\s*квартир', r[1] or '')]
        objs.append({'id': r[0], 'name': (r[1] or '').split(';')[0].strip()[:160], 'addr': address(r[1]), 'district': NORM.get(m.group(1)) if m else None,
                     'district_src': 'реестр' if m else None, 'q': q.group(1) if q else None, 'T': max(ys), 'flats': sum(fl) or None,
                     'developer': re.sub(r',\s*ИНН.*', '', r[3] or '').strip()[:80]})
    votes = collections.defaultdict(collections.Counter)
    for o in objs:
        if o['district'] and o['q']: votes[o['q']][o['district']] += 1
    bd = borders(list(IDS))
    for i, o in enumerate(objs):
        street = re.split(r'(?i),?\s*(?:д\.|дом\b|з/у|уч\.)', o['addr'])[0]
        o['ll'] = geocode(o['addr']) or (geocode(street) if street != o['addr'] else None)  # запасной — улица без дома
        o['ll_src'] = None if not o['ll'] else 'адрес' if GEO.get(o['addr']) else 'улица'
        if not o['district'] and o['ll']:
            d = next((IDS[k] for k, (segs, bb) in bd.items() if inside(o['ll'], segs)), None)
            if d: o['district'], o['district_src'] = d, 'по координатам'
        if not o['district'] and o['q'] in votes:
            o['district'], o['district_src'] = votes[o['q']].most_common(1)[0][0], 'по кадастровому кварталу'
        print(f"{i + 1}/{len(objs)} {o['district'] or '—':17} {o['T']} {o['addr'][:50]} {'✓' if o['ll'] else '✗'}", flush=True)
    for o in objs: o.pop('q')
    json.dump({'registry': REG.name, 'objects': objs}, open(HERE / 'gsn' / 'objects.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('строек', len(objs), '| с координатами', sum(1 for o in objs if o['ll']), '| с районом', sum(1 for o in objs if o['district']),
          collections.Counter(o['district_src'] for o in objs))
