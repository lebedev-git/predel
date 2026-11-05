# Проектная мощность школ Казани в свободном тексте страниц edu.tatar.ru (и отчётах о самообследовании).
# Обход сайта школы: страницы под адресом школы, сначала ссылки с «о школе / сведения / история / приём / документы»,
# не больше 40 страниц и 3 PDF на школу. Результат: C:/tmp/kzn/capscan/result.json
import json, re, html, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, quote, urlsplit, urlunsplit
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'
PRIO = re.compile(r'о школе|о гимнази|о лице|сведени|основн|истори|паспорт|при[её]м|документ|самообслед|материальн|общая информац|наша школа', re.I)
DOC = re.compile(r'самообслед|samoobsl|отч[её]т о результат|публичн', re.I)
CAP = re.compile(r'(проектн\w*\s+(?:мощност\w*|наполняемост\w*|вместимост\w*)|рассчитан\w*\s+на|предельн\w*\s+численност\w*)[^0-9]{0,60}(\d[\d \u00a0]{1,6})', re.I)
def fix(u):
    s = urlsplit(u); return urlunsplit((s.scheme, s.netloc, quote(s.path, safe='/%'), s.query, s.fragment))
def get(url, binary=False):
    for _ in range(2):
        try:
            r = urllib.request.urlopen(urllib.request.Request(fix(url), headers={'User-Agent': UA}), timeout=30).read()
            time.sleep(0.2); return r if binary else r.decode('utf-8', 'ignore')
        except Exception: time.sleep(1)
    return b'' if binary else ''
def text(h):
    h = re.sub(r'<style.*?</style>|<script.*?</script>', '', h, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h)))
def pdf_text(data):
    p = subprocess.run(['pdftotext', '-l', '20', '-', '-'], input=data, capture_output=True)
    return re.sub(r'\s+', ' ', p.stdout.decode('utf-8', 'ignore'))
def scan(r):
    base = r['url'].split('?')[0].rstrip('/')
    queue, seen, docs, hits, n = [(0, base)], set(), [], [], 0
    while queue and n < 40:
        queue.sort(); _, u = queue.pop(0)
        if u in seen: continue
        seen.add(u); n += 1
        h = get(u)
        for m in CAP.finditer(text(h)): hits.append(('html', u, m.group(0).strip()[:140]))
        if hits: break
        for href, a in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', h, flags=re.S):
            href = urljoin(u, href); a = re.sub(r'<[^>]+>', '', a)
            low = href.lower()
            if low.endswith('.pdf'):
                if DOC.search(a) or DOC.search(href): docs.append(href)
            elif href.startswith(base) and href not in seen and not low.endswith(('.doc', '.docx', '.jpg', '.png', '.xls', '.xlsx')):
                queue.append((0 if PRIO.search(a) else 1, href))
    if not hits:
        for d in list(dict.fromkeys(docs))[-3:]:
            for m in CAP.finditer(pdf_text(get(d, binary=True))): hits.append(('pdf', d, m.group(0).strip()[:140]))
            if hits: break
    return {'inn': r['inn'], 'name': r['name'], 'students': r['students'], 'pages': n, 'pdfs': len(docs), 'hits': hits[:3]}
rows = []
for r in json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8')):
    if r['тип'] == 'школа' and r.get('edu.tatar'):
        rows.append({'inn': r['ИНН'], 'name': r['название'], 'students': r.get('учеников 2026'), 'url': r['edu.tatar']})
print('школ', len(rows), flush=True)
with ThreadPoolExecutor(4) as ex: res = list(ex.map(scan, rows))
json.dump(res, open('C:/tmp/kzn/capscan/result.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('с мощностью в тексте:', sum(1 for x in res if x['hits']), 'из', len(res))
