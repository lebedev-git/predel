import json, re
from collections import defaultdict, Counter
C = json.load(open('catchments2.json', encoding='utf-8'))
E = json.load(open('C:/tmp/kzn/osm_55.800_49.080_55.845_49.170.json', encoding='utf-8'))['elements']
EDU = [x for x in json.load(open('C:/tmp/kzn/edu_tatar_nsav.json', encoding='utf-8'))['rows'] if x['type'] == 'school']
TYPEW = r'\b(ул|улица|пер|переулок|пр|пр-т|проспект|б-р|бульвар|проезд|пр-д|ш|шоссе|тракт|пл|площадь)\b\.?'
def toks(s):
    s = s.lower().replace('ё', 'е'); s = re.sub(TYPEW, ' ', s); s = re.sub(r'[^\w\s-]', ' ', s)
    return frozenset(w for w in s.split() if len(w) > 1 or w.isdigit())
def hn(h): return h.lower().replace(' ', '').replace('корпус', 'к').replace('корп.', 'к').replace('к.', 'к')
osm = defaultdict(list)
for e in E:
    t = e.get('tags', {})
    if 'building' not in t or 'addr:street' not in t or e['type'] == 'node': continue
    fl = int(t['building:flats']) if t.get('building:flats', '').isdigit() else 0
    osm[toks(t['addr:street'])].append((hn(t.get('addr:housenumber', '')), fl, t['building'], e['id']))
streets = list(osm)
def sts(name):
    tk = toks(name); return [s for s in streets if tk and tk <= s]
assign, info, miss = defaultdict(set), {}, defaultdict(list)
for slug, c in C.items():
    for st, n, ks in c['houses']:
        n = hn(n); ss = sts(st); hits = []
        for s in ss:
            for b in osm[s]:
                if (ks and b[0] in [n + 'к' + k for k in ks]) or (not ks and (b[0] == n or re.fullmatch(re.escape(n) + r'к\d+', b[0]))):
                    hits.append(b)
            if ks and not hits: hits += [b for b in osm[s] if b[0] == n]
        if not hits: miss[slug].append(f'{st} {n}' + (f' к{",".join(ks)}' if ks else '')); continue
        for b in hits: assign[b[3]].add(slug); info[b[3]] = b
    for st in c['full']:
        ss = sts(st)
        if not ss: miss[slug].append(st + ' (вся)'); continue
        for s in ss:
            for b in osm[s]: assign[b[3]].add(slug); info[b[3]] = b
rows = []
for slug, c in C.items():
    n = re.search(r'shkola-(\d+)', slug).group(1)
    cand = [x for x in EDU if re.search(r'№\s?' + n + r'\b', x['name']) and 'интернат' not in x['name'] and 'Адымнар' not in x['name']]
    stud = cand[0]['students'] if cand else None
    mine = [i for i in assign if slug in assign[i]]
    flats = sum(info[i][1] / len(assign[i]) for i in mine)
    priv = sum(1 / len(assign[i]) for i in mine if info[i][2] in ('house', 'detached', 'semidetached_house'))
    feq = flats + priv * 3.2 / 2.58
    kind = 'гимназия/лицей' if re.search(r'гимназ|лице', c['title'].lower()) else 'школа'
    tot = len(c['houses']) + len(c['full'])
    rows.append(dict(slug=slug, name=(cand[0]['name'] if cand else c['title'][23:70]), kind=kind, addr=tot, miss=len(miss[slug]), flats=round(flats), priv=round(priv), stud=stud, y=(stud / feq if stud and feq else None), small=tot < 10))
rows.sort(key=lambda r: (r['small'], r['kind'], -(r['y'] or 0)))
print(f"{'школа':40} {'тип':14} {'адр':>4} {'нет в OSM':>9} {'квартир':>7} {'частн':>5} {'учатся':>6} {'уч/кв':>6}")
for r in rows: print(f"{r['name'][:40]:40} {r['kind']:14} {r['addr']:>4} {r['miss']:>9} {r['flats']:>7} {r['priv']:>5} {str(r['stud']):>6} {('%.2f' % r['y']) if r['y'] else '—':>6}{'  (мелкое закрепление)' if r['small'] else ''}")
ok = [r for r in rows if not r['small'] and r['y']]
S = sum(r['stud'] for r in rows if r['stud']); F = sum(r['flats'] + r['priv'] * 3.2 / 2.58 for r in rows)
import statistics as st
for k in ('школа', 'гимназия/лицей'):
    ys = sorted(r['y'] for r in ok if r['kind'] == k)
    print(f"{k}: школ {len(ys)}, медиана {st.median(ys):.2f}, разброс {ys[0]:.2f}–{ys[-1]:.2f}")
print(f"ВСЕ 23 школы вместе: учатся {S} / квартир {round(F)} = {S / F:.3f}")
allmkd = sum(fl for k in osm for (_, fl, b, _) in osm[k] if fl)
print(f"квартир в многокв. домах всей выгрузки: {allmkd}; закреплено за этими 23 школами: {round(sum(info[i][1] for i in assign))} ({sum(info[i][1] for i in assign) / allmkd * 100:.0f}%)")
json.dump({'rows': rows, 'miss': miss}, open('yield_nsav2.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
