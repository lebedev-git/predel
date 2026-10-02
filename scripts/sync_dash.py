# Дашборд «Графики» внутри приложения: данные из конвейера (C:/tmp/demo/kzn/goroda/map) → public/dash/,
# чтобы все три продукта открывались с одного адреса (http://localhost:5180/dash/dash.html).
# ИП (частные сады) обезличиваются: в названии ИП — ФИО, ИНН ИП — личный. Сам dash.html живёт в public/dash.
# Запуск после пересборки данных:  python scripts/sync_dash.py
import json, pathlib, re, sys

SRC = pathlib.Path('C:/tmp/demo/kzn/goroda/map')
DST = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'dash'

charts = json.load(open(SRC / 'charts.json', encoding='utf-8'))
dash = json.load(open(SRC / 'dash_data.json', encoding='utf-8'))

alias = {}  # личный ИНН ИП → «ИП-n»
for o in charts['orgs']:
    if o['form'] == 'ИП' or re.match(r'ИП\s', o['name']):
        alias[o['inn']] = f'ИП-{len(alias) + 1}'
        o['inn'], o['name'] = alias[o['inn']], f"Частный {'детский сад' if o['type'] == 'kg' else 'образовательный центр'} (ИП)"

def anon(key):  # ключи dash_data: «ИНН» или «ИНН:kg»
    inn, _, tail = key.partition(':')
    return alias.get(inn, inn) + (':' + tail if tail else '')

for part in ('orgs', 'cap'):
    if isinstance(dash.get(part), dict): dash[part] = {anon(k): v for k, v in dash[part].items()}
for o in dash['orgs'].values():
    if o.get('form') == 'ИП': o['addr'] = re.sub(r',?\s*(д|кв)\.?\s*[\w/-]+$', '', o.get('addr') or '')  # адрес ИП бывает домашним — до улицы

# Блок «Проверка модели на истории»: город — прогноз из 2015 (kazan_pupils.json), район — из 2021 (nsav-history.json)
kp = json.load(open(SRC.parent / 'kazan_pupils.json', encoding='utf-8'))
nh = json.load(open(DST.parent / 'data' / 'nsav-history.json', encoding='utf-8'))
bt, TO = kp['backtest'], 2024  # «чистая» проверка — до 2024; 2025–2026 показываем отдельно
val = {
    'city': {'fact': {y: f['v'] for y, f in kp['fact'].items()}, 'cohort': {y: round(v) for y, v in kp['cohort'].items() if int(y) <= 2026},
             'r': kp['r'], 'origin': bt['origin'], 'k': bt['k'], 'pred': bt['pred'], 'err': bt['err'], 'naive': bt['naive'],
             'max_err': max(abs(e) for y, e in bt['err'].items() if int(y) <= TO), 'max_err_to': TO},
    'district': {'name': nh['district'], 'base': nh['base'], 'factYear': nh['factYear'],
                 **{t: {k: nh[t][k] for k in ('n', 'fact', 'back', 'err', 'naive')} for t in ('school', 'kg')}},
}

# Строящиеся и объявленные школы/сады: реестр Госстройнадзора РТ (жилья там много, образования — два сада)
# + новости/программы (C:/tmp/kzn/planned_edu.json, только цитаты, подтверждённые повторной загрузкой страницы)
GSN_URL = 'https://gsn.tatarstan.ru/reestr-obektov-kapitalnogo-stroitelstva-i.htm'
plan = [{'name': 'Детский сад в к. п. «Волжская Гавань»', 'kind': 'kg', 'capacity': 78, 'district': None, 'year': 2026,
         'status': 'строится · реестр Госстройнадзора РТ', 'url': GSN_URL},
        {'name': 'Детский сад, ул. Гаврилова', 'kind': 'kg', 'capacity': None, 'district': None, 'year': 2031,
         'status': 'строится · реестр Госстройнадзора РТ', 'url': GSN_URL}]
PF = pathlib.Path('C:/tmp/kzn/planned_edu.json')
def keep(r):  # в список: подтверждённая цитата, конкретный объект (не «[…] N школ по генплану»), горизонт 2026–2031, не ремонт
    y = r.get('year')
    return (r.get('quote_verified') and r.get('kind') in ('school', 'kg') and not r['name'].startswith('[')
            and (y is None or 2026 <= y <= 2031) and 'ремонт' not in (r.get('status') or ''))
# В линию мест (год ≠ None) — только то, что строится и откроется к сроку; спорное — в список без года:
FIX = {'Станция Юбилейная': {'year': 2027, 'status': 'строится · 1-й этап — до 01.12.2026, приём учеников — с 2027'},
       'ул. Родины': {'year': None, 'status': 'контракт 10.2025, срок 31.05.2026 · статус не подтверждён, возможен дубль лицея № 79 (2024)'}}
if PF.exists():
    for r in filter(keep, json.load(open(PF, encoding='utf-8'))):
        rec = {k: r.get(k) for k in ('name', 'kind', 'capacity', 'approx', 'district', 'year', 'status', 'url')}
        for key, upd in FIX.items():
            if key in rec['name']: rec.update(upd)
        plan.append(rec)

# Страница «Как считаем» (formula.html), шаг ②: коэффициенты формулы «новый дом → дети» — из самого gsn_forecast.py
sys.path.insert(0, str(SRC.parent))
from gsn_forecast import G7, G1, PACE, PUPILS_PER_KID, KG_COVER, VARIANTS, levels_from
coef = json.load(open(SRC.parent / 'coef_districts.json', encoding='utf-8'))
cc = coef['city']
formula = {'G7': G7, 'G1': G1, 'PACE': PACE, 'KG_COVER': KG_COVER, 'PUPILS_PER_KID': PUPILS_PER_KID,
           'level': {**levels_from(coef['districts']), 'Казань': min(cc['kids_7_17'] / (cc['flats'] + cc['izhs']), 0.36) * PUPILS_PER_KID},
           'flats': VARIANTS['mid'][0], 'year': 2026}

DST.mkdir(parents=True, exist_ok=True)
json.dump(formula, open(DST / 'formula.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(plan, open(DST / 'planned.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(charts, open(DST / 'charts.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(dash, open(DST / 'dash_data.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(val, open(DST / 'validation.json', 'w', encoding='utf-8'), ensure_ascii=False)

s = ''.join((DST / f).read_text(encoding='utf-8') for f in ('charts.json', 'dash_data.json', 'validation.json'))
leaks = [inn for inn in alias if inn in s] + re.findall(r'ИП [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+', s)
assert not leaks, f'остались ПДн ИП: {leaks[:3]}'
print(f'обезличено ИП: {len(alias)} → {DST}; проверка на истории → validation.json')
