# Дашборд «Графики» внутри приложения: данные из конвейера (C:/tmp/demo/kzn/goroda/map) → public/dash/,
# чтобы все три продукта открывались с одного адреса (http://localhost:5180/dash/dash.html).
# ИП (частные сады) обезличиваются: в названии ИП — ФИО, ИНН ИП — личный. Сам dash.html живёт в public/dash.
# Запуск после пересборки данных:  python scripts/sync_dash.py
import json, pathlib, re

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

DST.mkdir(parents=True, exist_ok=True)
json.dump(charts, open(DST / 'charts.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(dash, open(DST / 'dash_data.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(val, open(DST / 'validation.json', 'w', encoding='utf-8'), ensure_ascii=False)

s = ''.join((DST / f).read_text(encoding='utf-8') for f in ('charts.json', 'dash_data.json', 'validation.json'))
leaks = [inn for inn in alias if inn in s] + re.findall(r'ИП [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+', s)
assert not leaks, f'остались ПДн ИП: {leaks[:3]}'
print(f'обезличено ИП: {len(alias)} → {DST}; проверка на истории → validation.json')
