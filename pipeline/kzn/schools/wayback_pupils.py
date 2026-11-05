# Фактическое число учеников школ Казани по годам из архивных снимков карточек edu.tatar.ru (web.archive.org).
# Карточка школы пишет «У нас учатся: N учеников» на дату снимка. Учебный год = год сентября: снимок сентябрь–декабрь
# года Y и январь–июль года Y+1 относятся к Y. На учебный год берём снимок, ближайший к 1 октября.
# Выход: C:/tmp/kzn/wayback/facts.json {ИНН: {name, urls, snaps: [[дата, N]], years: {Y: N}}}
import json, re, html, time, urllib.request, os
from concurrent.futures import ThreadPoolExecutor
UA = {'User-Agent': 'Mozilla/5.0 (research; PREDEL school load study)'}
OUT = 'C:/tmp/kzn/wayback/facts.json'
def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60); time.sleep(1.0); return r
        except Exception: time.sleep(5 * (i + 1))
    return None
def cdx(url):
    r = get(f'https://web.archive.org/cdx/search/cdx?url={url}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:6')
    try: return [x[0] for x in json.loads(r.read())[1:]] if r else []
    except Exception: return []
def school(r):
    urls = {r['edu.tatar'].replace('https://', '').rstrip('/')}
    rr = get(r['edu.tatar'])
    if rr: urls.add(rr.url.replace('https://', '').rstrip('/'))
    stamps = sorted({(ts, u) for u in urls for ts in cdx(u)})
    best = {}
    for ts, u in stamps:
        y, m, d = int(ts[:4]), int(ts[4:6]), int(ts[6:8])
        sy = y if m >= 9 else y - 1
        if m in (8,): continue
        dist = abs((y * 12 + m) - (sy * 12 + 10))  # месяцев от октября учебного года
        if sy not in best or dist < best[sy][0]: best[sy] = (dist, ts, u)
    snaps, years = [], {}
    for sy, (_, ts, u) in sorted(best.items()):
        p = get(f'https://web.archive.org/web/{ts}id_/https://{u}')
        if not p: continue
        t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', p.read().decode('utf-8', 'ignore'))))
        m = re.search(r'У нас учатся:?\s*(\d[\d ]*)', t)
        if m:
            n = int(m.group(1).replace(' ', '')); snaps.append([ts[:8], n]); years[sy] = n
    return r['ИНН'], {'name': r['название'], 'urls': sorted(urls), 'snaps': snaps, 'years': years}
rows = [r for r in json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8')) if r['тип'] == 'школа' and r.get('edu.tatar')]
out = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
todo = [r for r in rows if r['ИНН'] not in out]
print('школ', len(rows), 'осталось', len(todo), flush=True)
with ThreadPoolExecutor(2) as ex:
    for n, (inn, rec) in enumerate(ex.map(school, todo), 1):
        out[inn] = rec
        print(n, rec['name'][:40], rec['years'], flush=True)
        if n % 10 == 0: json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ГОТОВО: с историей', sum(1 for v in out.values() if v['years']), 'из', len(out), flush=True)
