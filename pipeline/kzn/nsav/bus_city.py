# История учеников и воспитанников по госзаданиям bus.gov.ru — все школы и сады Казани (ИНН из C:/tmp/kzn/kazan_schools.json).
# Логика запросов и кэш (bus/) — из bus_fast.py; годы шире: 2016–2026, чтобы проверить, есть ли данные раньше 2020.
# Выход: bus_city.json {ИНН: {type, name, district, agency, years{год: n}}}. Частных организаций на bus.gov.ru нет — им «нет на bus.gov.ru».
import json, os
from concurrent.futures import ThreadPoolExecutor, as_completed

exec(open('C:/tmp/kzn/nsav/bus_fast.py', encoding='utf-8').read().split('jobs = []')[0])  # get, find, num, collect; chdir в nsav
YEARS = range(2016, 2027)  # collect() смотрит на глобальный YEARS

orgs = json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8'))
PAT = {'школа': ('программ начального', 'программ основного', 'программ среднего'), 'детский сад': ('дошкольного образования',)}
jobs = [o for o in orgs if o['форма'] not in ('ЧУ', 'ООО', 'ИП', 'АНО')]  # частные — не госучреждения
out = json.load(open('bus_city.json', encoding='utf-8')) if os.path.exists('bus_city.json') else {}
todo = [o for o in jobs if o['ИНН'] not in out]
print(f'организаций {len(orgs)}, госучреждений {len(jobs)}, осталось {len(todo)}', flush=True)
with ThreadPoolExecutor(4) as ex:
    futs = {ex.submit(collect, o['ИНН'], o['ИНН'], PAT[o['тип']]): o for o in todo}
    for n, f in enumerate(as_completed(futs), 1):
        o = futs[f]
        try: _, r = f.result()
        except Exception as e: r = {'inn': o['ИНН'], 'years': {}, 'note': f'ошибка {e}'}
        out[o['ИНН']] = {'type': o['тип'], 'name': o['название'], 'district': o['район'], **r}
        print(f"{n}/{len(todo)} {o['тип'][:5]} {o['название'][:40]} {r.get('years')}", flush=True)
        if n % 10 == 0 or n == len(todo):
            json.dump(out, open('bus_city.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ГОТОВО', flush=True)
