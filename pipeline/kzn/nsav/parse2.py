import json, re, html, subprocess, time, os
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"
C = json.load(open('catchments.json', encoding='utf-8'))
NUM = re.compile(r'(\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?)\s*(?:\(([^)]*)\))?')
out = {}
for slug in C:
    f = slug + '.html'
    if not os.path.exists(f):
        h = subprocess.run(['curl', '-s', '--noproxy', '*', '--max-time', '30', '-A', UA, 'https://kazan.fulledu.ru/shkola-po-propiske/novo-savinovsky/' + slug + '/'], capture_output=True).stdout.decode('utf-8', 'ignore')
        open(f, 'w', encoding='utf-8').write(h); time.sleep(0.3)
    h = open(f, encoding='utf-8').read()
    addrs = [html.unescape(a) for a in re.findall(r'"streetAddress":"([^"]*)"', h)]
    houses, full, notes = [], [], []
    for a in addrs:
        street, _, rest = a.partition(',')
        rest = rest.strip()
        if not rest or re.search(r'все дома|вся улица|полностью', rest):
            full.append(street.strip()); continue
        for m in NUM.finditer(rest):
            n, par = m.group(1), m.group(2)
            ks = re.findall(r'(?:корп\.?|к\.?)\s*(\d+)', par) if par else []
            if par and not ks: ks = re.findall(r'(\d+)', par)
            houses.append((street.strip(), n, ks))
        leftover = re.sub(r'[,\s]', '', NUM.sub('', rest))
        if leftover: notes.append(street + ': ' + rest[:90])
    out[slug] = {'title': C[slug]['title'], 'houses': houses, 'full': full, 'notes': notes}
    print(f'{slug:16} строк {len(addrs):3} | домов {len(houses):3} | улиц целиком {len(full):2} | неразобрано {len(notes)}: {notes[:1]}')
json.dump(out, open('catchments2.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
