# Заполнение лет, где задание на bus.gov.ru отдаёт 500 (2022–2023): госзадание утверждается на 3 года —
# в задании года Y−1 есть план на Y (firstYearPeriodValue), в задании Y−2 — план на Y (secondYearPeriodValue).
# Берём только из уже скачанного кэша bus/ (новых запросов не делает). Возвращает years и источник каждого года.
import json, os

CACHE = 'C:/tmp/kzn/nsav/bus'
PAT = {'school': ('программ начального', 'программ основного', 'программ среднего'), 'kg': ('дошкольного образования',)}
num = lambda s: float(str(s).replace(',', '.').replace(' ', '')) if s not in (None, '') else 0.0

def _load(name):
    f = f'{CACHE}/{name}.json'
    try: return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None
    except ValueError: return None

def _ind(x):  # все показатели «Число обучающихся» в ответе service-info, без повторов
    out = {}
    def walk(y):
        if isinstance(y, dict):
            if y.get('indicatorTitle') == 'Число обучающихся': out[json.dumps(y, sort_keys=True, ensure_ascii=False)] = y
            for v in y.values(): walk(v)
        elif isinstance(y, list):
            for v in y: walk(v)
    walk(x)
    return out.values()

def plan(aid, task_year, field, pat):
    """Сумма field по услугам pat в задании агентства за task_year; None — задания нет в кэше."""
    tl = _load(f'tasks{aid}') or {}
    t = next((t for t in tl.get('tasks', []) if int(t['financialYear']) == task_year), None)
    d = t and _load(f"task{t['id']}")
    if not d: return None
    tot, seen = 0.0, False
    for sv in d['currentTask'].get('stateTaskServiceList') or []:
        if not any(p in sv['compareString'].lower() for p in pat): continue
        si = _load(f"svc{sv['id']}")
        if si: seen = True; tot += sum(num(x.get(field)) for x in _ind(si))
    return round(tot) if seen and tot else None

def fill(rec, kind, years=range(2018, 2027)):
    """rec — запись bus_city.json. → ({год: n}, {год: источник})."""
    ys = {int(y): n for y, n in rec.get('years', {}).items() if n}
    src = {y: 'госзадание' for y in ys}
    aid = rec.get('agency')
    if not aid: return ys, src
    for y in years:
        if y in ys: continue
        v = plan(aid, y - 1, 'firstYearPeriodValue', PAT[kind])
        if v: ys[y], src[y] = v, f'план из задания {y - 1} г.'; continue
        v = plan(aid, y - 2, 'secondYearPeriodValue', PAT[kind])
        if v: ys[y], src[y] = v, f'план из задания {y - 2} г.'
    return dict(sorted(ys.items())), src

if __name__ == '__main__':
    b = json.load(open('C:/tmp/kzn/nsav/bus_city.json', encoding='utf-8'))
    gained = {}
    for inn, r in b.items():
        ys, src = fill(r, 'school' if r['type'] == 'школа' else 'kg')
        for y, s in src.items():
            if s != 'госзадание': gained[y] = gained.get(y, 0) + 1
    have = lambda y: sum(1 for r in b.values() if r.get('years', {}).get(str(y)))
    print('организаций', len(b))
    for y in range(2018, 2027): print(f'  {y}: было {have(y):3}, добавлено из плана прошлых лет {gained.get(y, 0):3}')
    # проверка на гимназии № 37: 2023 из задания 2022 г.
    g37 = next(r for r in b.values() if 'ГИМНАЗИЯ №37' in r['name'])
    print('гимназия № 37:', fill(g37, 'school'))
