# Единая таблица школ и садов Казани: реестр (ИНН, адрес, координаты, корпуса) + ученики edu.tatar.ru (01.10.2026) + район.
# Ключ: номер + тип организации («гимназия № 8»); спорное — улица и дом. Район — по координатам (границы OSM через Nominatim).
# Выход: kazan_schools.json, kazan_schools.csv (Excel: ;, utf-8-sig). ФИО и телефоны руководителей не выводим.
import csv, io, json, re, sys, zipfile, collections

sys.path.insert(0, 'C:/tmp/demo/kzn/goroda')
from fetch_osm_districts import borders, inside

ZIP = 'C:/Users/Andrey/Downloads/Telegram Desktop/БАЗА_ОБРАЗОВАТЕЛЬНЫХ_ОРГАНИЗАЦИЙ_РОССИИ.zip'
DIST = {2133461: 'Авиастроительный', 2133462: 'Вахитовский', 2133463: 'Кировский', 2133464: 'Московский',
        2133465: 'Ново-Савиновский', 2133466: 'Приволжский', 2133467: 'Советский'}
SLUG = {'aviastroit': 'Авиастроительный', 'vahit': 'Вахитовский', 'kirov': 'Кировский', 'moskow': 'Московский',
        'nsav': 'Ново-Савиновский', 'priv': 'Приволжский', 'sovetcki': 'Советский'}

def kind(s):
    s = s.lower()
    return 'интернат' if 'интернат' in s else 'гимназия' if 'гимназ' in s else 'лицей' if 'лице' in s else 'сад' if 'сад' in s or 'дошкол' in s else 'школа'

def num(s):
    s = s.replace('No ', '№ ').replace('N', '№') if re.search(r'N[oо]?\s*\d', s) else s  # на edu.tatar бывает «No 123», «N202»
    m = re.search(r'(?:№|N[oо]\.?)\s*(\d+)', s)  # на edu.tatar бывает «No 123»
    return m.group(1) if m else None

def street(a):  # «ул Борисковская, д 70А» / «ул. Ак.Сахарова, 3» → {'борисковская', '70а'}
    a = (a or '').lower().replace('ё', 'е')
    a = re.sub(r'\b(г|ул|пр-кт|проспект|пр|б-р|бульвар|пер|ш|д|дом|корп|к|стр|казань|республика|татарстан|рт)\b\.?', ' ', a)
    return {t for t in re.findall(r'[а-я]{4,}|\d+[а-я]?', a) if not re.fullmatch(r'4\d{5}', t)}  # без индекса

def load_registry():
    z = zipfile.ZipFile(ZIP)
    names = {(i.filename.encode('cp437').decode('cp866') if not (i.flag_bits & 0x800) else i.filename): i.filename for i in z.infolist()}
    P = 'БАЗА_ОБРАЗОВАТЕЛЬНЫХ_ОРГАНИЗАЦИЙ_РОССИИ/'
    rd = lambda f: list(csv.DictReader(io.StringIO(z.read(names[P + f]).decode('utf-8-sig')), delimiter=';'))
    orgs = {'school': [r for r in rd('2_Школы/Школы_России.csv') if r['Населённый пункт'] == 'Казань'],
            'kindergarten': [r for r in rd('3_Детские_сады/Детские_сады_России.csv') if r['Населённый пункт'] == 'Казань']}
    places = collections.Counter(r['ИНН'] for r in rd('2_Школы/Адреса_школ.csv') if 'Казань' in (r.get('Адрес места') or ''))
    return orgs, places

GENERIC = set('муниципальное автономное бюджетное казенное государственное общеобразовательное общеобразовательная образовательное образовательная '
              'организация учреждение дошкольное дошкольная детский школа гимназия гимназиум лицей частная частное некоммерческая автономная '
              'центр образования казань казани казанская города город республики татарстан комбинированного вида средняя общая интернат академия '
              'района приволжского советского кировского московского вахитовского авиастроительного савиновского '
              'мбоу маоу мадоу мбдоу аноо гбоу гаоу чоу чдоу андоо оано чудо'.split())  # формы и общие слова названий не различают

def words(s):  # характерные слова названия: «Аврора», «Сократ», «Фиолетовая корова»
    return {w for w in re.findall(r'[а-яa-z]{4,}', s.lower().replace('ё', 'е')) if w not in GENERIC}

def addr_ok(a, b):  # совпали и улица, и номер дома
    x = street(a) & street(b)
    return any(t.isalpha() for t in x) and any(t[0].isdigit() for t in x)

def match(reg, edu):
    """edu.tatar → запись реестра. 1) с номером: тот же номер → тип → улица+дом; 2) без номера — по оставшимся: характерное слово названия или улица+дом."""
    by_num = collections.defaultdict(list)
    for r in reg: by_num[num(r['Полное наименование']) or num(r['Краткое наименование'])].append(r)
    out, used = {}, set()
    for e in [e for e in edu if num(e['name'])]:
        cand = [r for r in by_num.get(num(e['name']), []) if r['ИНН'] not in used]
        same = [r for r in cand if kind(r['Полное наименование']) == kind(e['name'])] or cand
        same.sort(key=lambda r: -len(street(r['Адрес']) & street(e.get('address'))))
        if same: out[e['url']] = same[0]; used.add(same[0]['ИНН'])
    for e in [e for e in edu if not num(e['name'])]:
        score = lambda r: len(words(r['Полное наименование'] + ' ' + r['Краткое наименование']) & words(e['name']))
        free = [r for r in reg if r['ИНН'] not in used and not (num(r['Полное наименование']) or num(r['Краткое наименование']))]  # у безномерных — только безномерные
        best = sorted(free, key=score, reverse=True)[:2]
        if best and score(best[0]) and (len(best) == 1 or score(best[0]) > score(best[1])): pick = best[0]
        else:
            byaddr = [r for r in free if addr_ok(r['Адрес'], e.get('address'))]
            pick = byaddr[0] if len(byaddr) == 1 else None  # неоднозначное не сшиваем
        if pick: out[e['url']] = pick; used.add(pick['ИНН'])
    return out

if __name__ == '__main__':
    orgs, places = load_registry()
    edu = json.load(open('edu_tatar_contingent.json', encoding='utf-8'))['rows']
    bd = borders(list(DIST))
    def district(r):
        try: pt = (float(r['Долгота']), float(r['Широта']))
        except ValueError: return None
        return next((DIST[i] for i, (segs, bb) in bd.items() if bb[0] <= pt[0] <= bb[2] and bb[1] <= pt[1] <= bb[3] and inside(pt, segs)), None)
    rows = []
    for ty, reg in orgs.items():
        e_ty = [e for e in edu if e['type'] == ty]
        m = match(reg, e_ty)
        by_inn = {r['ИНН']: e for e in e_ty for u, r in m.items() if u == e['url']}
        for r in reg:
            e = by_inn.get(r['ИНН'], {})
            rows.append({'тип': 'школа' if ty == 'school' else 'детский сад', 'ИНН': r['ИНН'], 'название': r['Краткое наименование'],
                         'форма': r['Форма'], 'район': district(r) or SLUG.get(e.get('district')), 'адрес': r['Адрес'],
                         'широта': r['Широта'], 'долгота': r['Долгота'], 'адресов обучения': places.get(r['ИНН']) if ty == 'school' else None,
                         'учеников 2026': e.get('students'), 'edu.tatar': e.get('url'), 'аккредитация': r['Аккредитация'],
                         'лицензия': r['Ссылка на лицензию']})
        unmatched = [e for e in e_ty if e['url'] not in m]
        print(f'{ty}: в реестре {len(reg)}, на edu.tatar {len(e_ty)}, сшито {len(m)}; не сшиты с edu.tatar: {len(unmatched)}',
              [e['name'][:40] for e in unmatched[:8]])
    json.dump(rows, open('kazan_schools.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open('kazan_schools.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter=';'); w.writeheader(); w.writerows(rows)
    s = [r for r in rows if r['тип'] == 'школа']
    print('школ с учениками:', sum(1 for r in s if r['учеников 2026']), 'учеников:', sum(r['учеников 2026'] or 0 for r in s),
          '| без района:', sum(1 for r in rows if not r['район']))
    for d in sorted({r['район'] for r in s if r['район']}):
        ds = [r for r in s if r['район'] == d]
        print(f'  {d:18} школ {len(ds):3}  с учениками {sum(1 for r in ds if r["учеников 2026"]):3}  учеников {sum(r["учеников 2026"] or 0 for r in ds):7,}')
