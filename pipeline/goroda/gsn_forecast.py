# Добавка детей от строящихся домов (реестр ГСН РТ, gsn/objects.json) по формуле ПРЕДЕЛ:
#   дети(y) = квартиры × заселение(y) × уровень зрелого дома района × форма немецкой волны(возраст дома).
# Квартир в реестре почти нет → диапазон на объект; срок разрешения → дата сдачи с запаздыванием 0–1 год.
#   низ: 250 кв., сдача T+1   середина: 320 кв., T+1   верх: 400 кв., T
# Школа: уровень = дети 7–17 на квартиру в районе × 0,96 (учеников на ребёнка по городу), форма — немецкая кривая МКД 7–17 лет.
# Сад: немецкая кривая МКД 1–6 лет (дети на квартиру по возрасту дома) × 0,70 (по городу в сад ходит 70 из 100).
import json, pathlib

HERE = pathlib.Path(__file__).parent
G7 = [0.196, 0.198, 0.202, 0.206, 0.213, 0.221, 0.232, 0.244, 0.259, 0.273, 0.285, 0.295, 0.302, 0.307, 0.310]  # GGR, МКД, 7–17 лет
G1 = [0.153, 0.164, 0.176, 0.187, 0.194, 0.196, 0.195, 0.190, 0.181, 0.167, 0.150, 0.133, 0.117, 0.102, 0.088]  # GGR, МКД, 1–6 лет
PACE = [0.5, 0.8, 0.95, 1.0]
VARIANTS = {'lo': (250, 1), 'mid': (320, 1), 'hi': (400, 0)}
PUPILS_PER_KID, KG_COVER = 0.96, 0.70

def settle(y, t): return 0 if y < t else PACE[min(y - t, 3)]
def age(y, t): return min(max(y - t + 1, 1), 15)

def levels_from(coef):  # потолок 0,36: у Авиастроительного частные дома в OSM недосчитаны, уровень завышен (0,44)
    return {k.replace(' район', ''): min(v['kids_per_home'], 0.36) * PUPILS_PER_KID for k, v in coef.items()}

def objects():
    return [o for o in json.load(open(HERE / 'gsn' / 'objects.json', encoding='utf-8'))['objects'] if o['district']]

def kids(o, y, kind, level, var):
    flats, lag = VARIANTS[var]
    f, t = (o['flats'] or flats), o['T'] + lag
    s = settle(y, t)
    if not s: return 0.0
    if kind == 'school': return f * s * level * G7[age(y, t) - 1] / G7[-1]
    return f * s * G1[age(y, t) - 1] * KG_COVER

def component(objs, levels, years=range(2026, 2034)):
    """{район: {'school': {год: [низ, середина, верх]}, 'kg': …, 'count': n, 'by_T': {срок: n}}} + 'Казань'."""
    out = {}
    for d in sorted({o['district'] for o in objs}) + ['Казань']:
        mine = [o for o in objs if d == 'Казань' or o['district'] == d]
        rec = {'count': len(mine), 'by_T': {}}
        for o in mine: rec['by_T'][o['T']] = rec['by_T'].get(o['T'], 0) + 1
        for kind in ('school', 'kg'):
            rec[kind] = {y: [round(sum(kids(o, y, kind, levels[o['district']], v) for o in mine)) for v in ('lo', 'mid', 'hi')] for y in years}
        out[d] = rec
    return out

if __name__ == '__main__':
    coef = json.load(open(HERE / 'coef_districts.json', encoding='utf-8'))['districts']
    levels = levels_from(coef)
    c = component(objects(), levels)
    print('уровень зрелого дома (учеников на квартиру):', {k: round(v, 3) for k, v in levels.items()})
    for d, r in c.items():
        print(f"{d:18} строек {r['count']:3}  школа 2027 {r['school'][2027]}  2030 {r['school'][2030]}  2033 {r['school'][2033]} | сад 2030 {r['kg'][2030]}")
