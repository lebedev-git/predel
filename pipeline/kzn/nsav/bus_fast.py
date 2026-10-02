# История контингента по госзаданиям bus.gov.ru: школы и сады Ново-Савиновского района, 2020–2026, 4 потока, кэш в bus/.
import json, subprocess, time, os, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
os.chdir('C:/tmp/kzn/nsav')
YEARS = range(2020, 2027)

def get(url, key):
    f = f'bus/{key}.json'
    if os.path.exists(f) and os.path.getsize(f) > 100:
        try:
            with open(f, encoding='utf-8') as fh: return json.load(fh)
        except Exception: pass  # недописанный файл кэша — перекачать и перезаписать
    for a in range(2):
        r = subprocess.run(['curl', '-s', '-k', '--noproxy', '*', '--max-time', '30', '-A', UA, url], capture_output=True)
        try:
            d = json.loads(r.stdout.decode('utf-8'))
            tmp = f'{f}.{threading.get_ident()}.tmp'
            with open(tmp, 'w', encoding='utf-8') as fh: json.dump(d, fh, ensure_ascii=False)
            try: os.replace(tmp, f)
            except OSError: pass
            return d
        except Exception: time.sleep(3)
    return None

def find(x):
    if isinstance(x, dict):
        if x.get('indicatorTitle') == 'Число обучающихся': yield x
        for v in x.values(): yield from find(v)
    elif isinstance(x, list):
        for v in x: yield from find(v)
num = lambda s: float(str(s).replace(',', '.').replace(' ', '')) if s not in (None, '') else 0.0

def collect(key, inn, pat):
    s = get(f'https://bus.gov.ru/public-rest/api/agency/extendedSearchAgencyNew?searchString={inn}&withBranches=true&page=1&pageSize=10&orderAttributeName=rank&searchTermCondition=or', f'search{inn}')
    ag = (s or {}).get('agencies') or []
    if not ag: return key, {'inn': inn, 'years': {}, 'note': 'нет на bus.gov.ru'}
    aid = ag[0]['agencyId']
    tl = get(f'https://bus.gov.ru/public/agency/agency_tasks.json?agency={aid}', f'tasks{aid}')
    years = {}
    for t in (tl or {}).get('tasks', []):
        if int(t['financialYear']) not in YEARS: continue
        d = get(f"https://bus.gov.ru/public/agency/agency_tasks.json?agency={aid}&task={t['id']}", f"task{t['id']}")
        if not d: years[t['financialYear']] = None; continue
        tot = 0.0
        for sv in d['currentTask'].get('stateTaskServiceList') or []:
            if not any(p in sv['compareString'].lower() for p in pat): continue
            si = get(f"https://bus.gov.ru/public/agency/service-info.json?serviceId={sv['id']}", f"svc{sv['id']}")
            if si: tot += sum(num(x.get('nextYearValue')) for x in {json.dumps(x, sort_keys=True, ensure_ascii=False): x for x in find(si)}.values())
        years[t['financialYear']] = round(tot)
    return key, {'inn': inn, 'agency': aid, 'years': years}

jobs = []
for slug, v in json.load(open('inn.json', encoding='utf-8')).items():
    if v: jobs.append(('school', slug, v[0][0], ('программ начального', 'программ основного', 'программ среднего')))
for inn, name in json.load(open('kg_inn.json', encoding='utf-8')).items():
    jobs.append(('kg', name, inn, ('дошкольного образования',)))
out = {'school': {}, 'kg': {}}
with ThreadPoolExecutor(4) as ex:
    futs = {ex.submit(collect, k, i, p): kind for kind, k, i, p in jobs}
    for n, f in enumerate(as_completed(futs), 1):
        kind = futs[f]; key, r = f.result(); out[kind][key] = r
        print(f'{n}/{len(jobs)} {kind} {key[:40]} {r["years"]}', flush=True)
        with open('bus_all.json', 'w', encoding='utf-8') as fh: json.dump(out, fh, ensure_ascii=False, indent=1)
print('ГОТОВО', flush=True)
