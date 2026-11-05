# Фактическое число обучающихся школ Казани по годам из отчётов об исполнении муниципального задания (bus.gov.ru).
# Цепочка: агентство (nsav/bus_city.json) → задания по годам (agency_tasks.json, кэш nsav/bus/) → список отчётов задания
# (currentTask.stateTaskReportList) → отчёт report-info.json?reportId=… → сумма actualValue показателя «Число обучающихся»
# по программам начального, основного и среднего общего образования. Берётся последний по дате отчёт задания (годовой).
# TLS: корневой и выпускающий сертификаты Минцифры (gosuslugi.ru/landing/crt), проверены по отпечатку, файл certs/ru_bundle.pem.
# Выход: C:/tmp/kzn/busfact/facts.json {ИНН: {name, years: {год: факт}, plan: {год: план}}}
import json, os, subprocess, time
from concurrent.futures import ThreadPoolExecutor
CA = 'C:/tmp/kzn/certs/ru_bundle.pem'
CACHE_OLD, CACHE = 'C:/tmp/kzn/nsav/bus', 'C:/tmp/kzn/busfact/cache'
os.makedirs(CACHE, exist_ok=True)
PAT = ('программ начального', 'программ основного', 'программ среднего')
num = lambda s: float(str(s).replace(',', '.').replace(' ', '')) if s not in (None, '') else 0.0

def get(url, key, refresh=False):
    for d in ([] if refresh else [CACHE_OLD]) + [CACHE]:
        f = f'{d}/{key}.json'
        if os.path.exists(f) and os.path.getsize(f) > 100:
            try: return json.load(open(f, encoding='utf-8'))
            except Exception: pass
    for _ in range(3):
        r = subprocess.run(['curl', '-s', '--cacert', CA, '--max-time', '40', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128', url], capture_output=True)
        try:
            d = json.loads(r.stdout.decode('utf-8'))
            json.dump(d, open(f'{CACHE}/{key}.json', 'w', encoding='utf-8'), ensure_ascii=False); time.sleep(0.3); return d
        except Exception: time.sleep(3)
    return None

def school(item):
    inn, rec = item
    aid = rec.get('agency')
    if not aid: return inn, {'name': rec.get('name'), 'years': {}, 'note': rec.get('note', 'нет агентства')}
    tl = get(f'https://bus.gov.ru/public/agency/agency_tasks.json?agency={aid}', f'tasks{aid}')
    years = {}
    for t in (tl or {}).get('tasks', []):
        y = int(t['financialYear'])
        if y < 2016: continue
        d = get(f"https://bus.gov.ru/public/agency/agency_tasks.json?agency={aid}&task={t['id']}", f"task{t['id']}")
        reps = ((d or {}).get('currentTask') or {}).get('stateTaskReportList') or []
        if not reps and y < 2026:  # в старом кэше отчёта могло ещё не быть — перечитать
            d = get(f"https://bus.gov.ru/public/agency/agency_tasks.json?agency={aid}&task={t['id']}", f"task{t['id']}", refresh=True)
            reps = ((d or {}).get('currentTask') or {}).get('stateTaskReportList') or []
        if not reps: continue
        rep = max(reps, key=lambda r: r.get('date') or 0)
        ri = get(f"https://bus.gov.ru/public/agency/report-info.json?reportId={rep['id']}", f"rep{rep['id']}")
        tot, seen = 0.0, set()
        def walk(o):
            nonlocal tot
            if isinstance(o, dict):
                vi = o.get('volumeIndicatorItem')
                if isinstance(vi, dict) and vi.get('indicatorTitle') == 'Число обучающихся' and any(p in (vi.get('taskServiceName') or '').lower() for p in PAT) and o.get('id') not in seen:
                    seen.add(o.get('id')); tot += num(o.get('actualValue'))
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk((ri or {}).get('taskReport'))
        if tot: years[y] = round(tot)
    return inn, {'name': rec.get('name'), 'agency': aid, 'years': years, 'plan': rec.get('years', {})}

BUS = json.load(open('C:/tmp/kzn/nsav/bus_city.json', encoding='utf-8'))
items = [(inn, r) for inn, r in BUS.items() if r.get('type') == 'школа']
out = {}
with ThreadPoolExecutor(3) as ex:
    for n, (inn, rec) in enumerate(ex.map(school, items), 1):
        out[inn] = rec
        print(n, (rec.get('name') or '')[:40], rec['years'], flush=True)
        if n % 10 == 0: json.dump(out, open('C:/tmp/kzn/busfact/facts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(out, open('C:/tmp/kzn/busfact/facts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ГОТОВО: школ с фактом', sum(1 for v in out.values() if v['years']), 'из', len(out), flush=True)
