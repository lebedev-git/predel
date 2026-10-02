# БДПМО Росстата (munst92 — Татарстан): показатель по городскому округу Казань за все годы формы → bdpmo/{id}.json.
# Запрос собираем так же, как JS формы (InitCodesArray + ExtractAttrCodes): коды измерений берём из страницы показателя.
# Запуск: python fetch_bdpmo.py 8015002 [ещё id…]
import json, re, ssl, sys, urllib.parse, urllib.request, pathlib, html

ROOT = pathlib.Path(__file__).parent
URL = 'https://rosstat.gov.ru/dbscripts/munst/munst92/DBInet.cgi'
CTX = ssl._create_unverified_context()
UA = {'User-Agent': 'Mozilla/5.0'}
KAZAN = '92701000'  # ОКТМО/ОКАТО г. Казань

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
        return r.read().decode('cp1251', 'replace')

def fetch(pid):
    s = get(f'{URL}?pl={pid}')
    init = s[s.find('function InitCodesArray'):]
    init = init[:init.find('}')]
    codes = {}
    for dim, i, v in re.findall(r'p_(\w+)\[(\d+)\]\s*=\s*"([^"]*)"', init):
        codes.setdefault(dim, []).append(v)
    dims = [d for d in codes if d != 'Pokazateli']
    pick = {'Pokazateli': [pid]}
    for d in dims:
        c = codes[d]
        if KAZAN in c: pick[d] = [KAZAN]                   # муниципалитет / ОКТМО
        elif d == 'god': pick[d] = c                       # все годы
        elif d == 'tippos': pick[d] = ['7'] if '7' in c else c[:1]  # городской округ
        else: pick[d] = c                                  # период, прочее — всё
    qry = ''.join(f'{d}:{",".join(v)};' for d, v in pick.items())
    z = [d for d in pick if d != 'god']
    gm = ''.join(f'{d}_z:{i + 1};' for i, d in enumerate(z)) + 'god_s:1;'
    years = re.search(r'NAME="YearsList" VALUE="([^"]*)"', s).group(1)
    body = urllib.parse.urlencode({'rdLayoutType': 'Au', 'Qry': qry, 'QryGm': gm, 'QryFootNotes': ';', 'YearsList': years,
                                   'tbl': 'Показать таблицу'}, encoding='cp1251').encode()
    t = get(URL, body)
    (ROOT / 'bdpmo').mkdir(exist_ok=True)
    (ROOT / 'bdpmo' / f'{pid}.html').write_text(t, encoding='utf-8')
    cells = [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'(?is)<t[dh][^>]*>(.*?)</t[dh]>', t)]
    yrs = [c for c in cells if re.fullmatch(r'20\d\d', c)]
    nums = [c for c in cells if re.fullmatch(r'-?[\d\s\xa0]+([.,]\d+)?', c) and not re.fullmatch(r'20\d\d', c)]
    title = re.search(r"id='t\d+'>([^<]*)", s) or re.search(r'<OPTION SELECTED>([^<]*)', s)
    return {'id': pid, 'title': title.group(1).strip() if title else '', 'query': qry,
            'data': dict(zip(map(int, yrs), [float(n.replace(' ', '').replace('\xa0', '').replace(',', '.')) for n in nums[-len(yrs):]])) if nums else {}}

if __name__ == '__main__':
    for pid in sys.argv[1:]:
        r = fetch(pid)
        json.dump(r, open(ROOT / 'bdpmo' / f'{pid}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(pid, r['title'][:80], r['data'])
