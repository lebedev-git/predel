# Вместимость новых школ (new_schools_capacity.json, собрал агент) → независимая перепроверка цитат свежей загрузкой
# и загрузка 2026: ученики edu.tatar.ru (kazan_schools.json) / проектная мощность (здание + корпуса одной школы).
import json, re, subprocess, collections, sys, html
sys.stdout.reconfigure(encoding='utf-8')
R = json.load(open('C:/tmp/kzn/new_schools_capacity.json', encoding='utf-8'))
S = json.load(open('C:/tmp/kzn/kazan_schools.json', encoding='utf-8'))
norm = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s)).replace('\xa0', ' ')).strip()

def fresh(url):  # свежая загрузка, не кэш агента; госсайты и СМИ РТ — curl --noproxy
    r = subprocess.run(['curl', '-s', '-k', '-L', '--noproxy', '*', '--max-time', '40', '-A', 'Mozilla/5.0', url], capture_output=True)
    return norm(r.stdout.decode('utf-8', 'replace'))

rows = [r for r in R if r['capacity'] and r['kind'] in ('новое здание', 'корпус/пристрой')]
ok = {}
for r in rows:
    num = re.sub(r'\D', '', str(r['capacity']))
    q = norm(r['quote'])
    has_num = bool(re.search(r'\b' + r'\s?'.join(num[:-3]) + r'\s?' + num[-3:] + r'\b', q)) if len(num) > 3 else num in q
    ok[id(r)] = has_num and q in fresh(r['url'])
    print('✓' if ok[id(r)] else '✗', r['number'], r['opened'], r['capacity'], r['url'][:70], '' if has_num else '(в цитате нет числа)')

def pupils(num, district, kind):  # kind — «лицей»/«гимназия»/«школа»: у №11 в Советском их три
    hit = [s for s in S if s['тип'] == 'школа' and s['район'] == district and re.search(rf'№\s*{num}\b', s['название'])
           and s['учеников 2026'] and kind in s['название'].lower()]
    return hit[0]['учеников 2026'] if len(hit) == 1 else None

# загрузка — только где вся школа в новом здании (+ её новые корпуса); у корпусов старых школ мощность основного здания неизвестна
new = {(r['number'], r['district']) for r in rows if r['kind'] == 'новое здание' and isinstance(r['number'], int)}
cap, kind = collections.defaultdict(int), {}
for r in rows:
    k = (r['number'], r['district'])
    if k in new:
        cap[k] += r['capacity']
        kind.setdefault(k, next(w for w in ('лицей', 'гимназия', 'школа') if w in r['name'].lower()))
out = []
for (num, d), c in sorted(cap.items()):
    p = pupils(num, d, kind[(num, d)])
    out.append({'number': num, 'district': d, 'capacity': c, 'pupils_2026': p, 'load': round(p / c, 2) if p else None})
    print(f"№{num:<4} {d:17} мест {c:5}  учеников {p or '—':>5}  загрузка {f'{p / c:.0%}' if p else '—'}")
known = [o for o in out if o['load']]
print('проверено цитат', sum(ok.values()), 'из', len(rows), '| школ с загрузкой', len(known),
      '| мест', sum(o['capacity'] for o in known), 'учеников', sum(o['pupils_2026'] for o in known),
      f"| в среднем {sum(o['pupils_2026'] for o in known) / sum(o['capacity'] for o in known):.0%}")
assert all(o['load'] is None or 0.2 < o['load'] < 4 for o in out), 'загрузка вне разумного — проверить сопоставление'
json.dump({'checked': {r['url']: ok[id(r)] for r in rows}, 'schools': out}, open('C:/tmp/kzn/new_schools_load.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
