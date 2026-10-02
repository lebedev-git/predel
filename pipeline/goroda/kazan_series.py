# Ряды по Казани из таблиц «Социально-экономическая характеристика» всех выпусков → kazan_series.json.
# В выпуске по Казани два года (столбцы); при пересечении берём более поздний выпуск (уточнённые данные).
import json, re, pathlib

ROOT = pathlib.Path(__file__).parent
IND = [  # (ключ, регэксп по названию строки) — первое совпадение в таблице
    ('pop', r'^численность населения'),
    ('birth_rate', r'число родившихся на 1'),
    ('migration', r'миграционный прирост'),
    ('kids_1_6', r'детей в возрасте 1\s*[–-]\s*6'),
    ('schools', r'^число (дневных )?общеобразовательных'),
    ('pupils', r'численность (учащихся|обучающихся).*общеоб'),
    ('kg_places', r'^(мест, тыс|число мест в (дошкольных )?(организациях|учреждениях))'),
    ('kg_children', r'^(детей, тыс|численность воспитанников)'),
    ('housing_m2', r'(^жилые дома, тыс|ввод в действие (общей площади )?жилых домов)'),
    ('flats', r'^(квартиры|число построенных квартир)'),
    ('school_places_built', r'общеобразовательн\w* (учреждения|организаций), ученических мест'),
    ('kg_places_built', r'^дошкольн\w* (учреждения|образовательных организаций), мест'),
]

def num(s):
    s = s.replace('\xa0', '').replace(' ', '').replace(',', '.').strip()
    s = re.sub(r'\d\)$', '', s)  # сноска «…4)»
    try: return float(s)
    except ValueError: return None

series, src = {k: {} for k, _ in IND}, {k: {} for k, _ in IND}
for f in sorted((ROOT / 'tables').glob('*.json'), key=lambda p: int(p.stem)):
    ed = int(f.stem)
    for t in json.load(open(f, encoding='utf-8')):
        rows = t['rows']
        if len(rows) < 5 or not any('казан' in c.lower() for c in rows[0]): continue
        cols = [i for i, c in enumerate(rows[0]) if 'казан' in c.lower() and re.fullmatch(r'(19|20)\d\d', rows[1][i].strip())]
        if not cols: continue
        seen = set()
        for r in rows[2:]:
            name = re.sub(r'\s+', ' ', r[0].replace('- ', '')).strip().lower()
            for k, rx in IND:
                if k in seen or not re.search(rx, name): continue
                seen.add(k)
                for i in cols:
                    v = num(r[i]) if i < len(r) else None
                    y = int(rows[1][i])
                    if v is not None and (y not in src[k] or src[k][y] <= ed):
                        series[k][y], src[k][y] = v, ed
                break

out = {k: dict(sorted(v.items())) for k, v in series.items()}
# число родившихся = коэффициент × население (среднее начала и конца года ≈ население на конец)
out['births'] = {y: round(out['birth_rate'][y] * out['pop'][y]) for y in out['birth_rate'] if y in out['pop']}
json.dump({'series': out, 'edition': src, 'source': 'Росстат, «Регионы России. Основные социально-экономические показатели городов», выпуски 2004–2024'},
          open(ROOT / 'kazan_series.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for k, v in out.items():
    print(f'{k:20}', ' '.join(f'{y}:{v[y]:g}' for y in v) if v else '—')
